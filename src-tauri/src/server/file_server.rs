use hyper::{
    header,
    service::{make_service_fn, service_fn},
    Body, Request, Response, Server, StatusCode,
};
use std::convert::Infallible;
use std::{
    collections::HashMap,
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt},
};
use tokio_util::io::ReaderStream;
use urlencoding::decode;

type SharedState = Arc<Mutex<HashMap<String, PathBuf>>>;

async fn serve_file(req: Request<Body>, state: SharedState) -> Result<Response<Body>, Infallible> {
    let uri_path = decode(req.uri().path().trim_start_matches('/')).unwrap();
    let mut path = PathBuf::from(&*uri_path);

    // If not an absolute path, try resolving relative to last known parent
    if !path.is_absolute() {
        let state_guard = state.lock().unwrap();
        if let Some(last_dir) = state_guard.get("last_dir") {
            path = last_dir.join(&path);
        }
    }

    // Remember this directory for next time
    if path.is_file() {
        if let Some(parent) = path.parent() {
            let mut state_guard = state.lock().unwrap();
            state_guard.insert("last_dir".into(), parent.to_path_buf());
        }
    }

    // Serve file if it exists
    if !path.exists() {
        return Ok(Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header("Access-Control-Allow-Origin", "*")
            .body(Body::from(format!("File not found: {:?}", path)))
            .unwrap());
    }

    let mut file = match File::open(&path).await {
        Ok(f) => f,
        Err(_) => {
            return Ok(Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header("Access-Control-Allow-Origin", "*")
                .body(Body::from("Could not open file"))
                .unwrap());
        }
    };

    let metadata = file.metadata().await.unwrap();
    let file_size = metadata.len();
    let mime_type = mime_guess::from_path(&path).first_or_octet_stream();

    let mut start: u64 = 0;
    let mut end: u64 = file_size - 1;
    let mut status = StatusCode::OK;

    if let Some(range_header) = req.headers().get(header::RANGE) {
        if let Ok(range_str) = range_header.to_str() {
            if let Some(range) = range_str.strip_prefix("bytes=") {
                let parts: Vec<&str> = range.split('-').collect();
                if let Ok(s) = parts[0].parse::<u64>() {
                    start = s;
                }
                if parts.len() > 1 && !parts[1].is_empty() {
                    if let Ok(e) = parts[1].parse::<u64>() {
                        end = e;
                    }
                }
                if end >= file_size {
                    end = file_size - 1;
                }
                status = StatusCode::PARTIAL_CONTENT;
            }
        }
    }

    file.seek(std::io::SeekFrom::Start(start)).await.unwrap();
    let limited = file.take(end - start + 1);
    let stream = ReaderStream::new(limited);
    let body = Body::wrap_stream(stream);

    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, mime_type.as_ref())
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, (end - start + 1).to_string())
        .header("Access-Control-Allow-Origin", "*");

    if status == StatusCode::PARTIAL_CONTENT {
        builder = builder.header(
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{}", start, end, file_size),
        );
    }

    Ok(builder.body(body).unwrap())
}

pub async fn start_server(addr: SocketAddr) {
    let state = Arc::new(Mutex::new(HashMap::new()));
    let make_svc = make_service_fn(move |_conn| {
        let state = state.clone();
        async move { Ok::<_, Infallible>(service_fn(move |req| serve_file(req, state.clone()))) }
    });

    let server = Server::bind(&addr).serve(make_svc);
    if let Err(e) = server.await {
        eprintln!("Server error: {}", e);
    }
}
