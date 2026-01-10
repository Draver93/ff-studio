// graph/nodes.js
// Litegraph node definitions

const { invoke } = window.__TAURI__.core;
const { open, save } = window.__TAURI__.dialog;

import { addLogEntry } from '../logs/logs.js';
import * as graph_consts from './constants.js';


const ffmpegTypeMap = {
    "<enum>": (node, opt) => {
        if(opt.enum_vals) {
            let values = [""].concat(opt.enum_vals);
            node.addProperty(opt.flag, "", "enum", { values });
            node.addWidget("combo", opt.flag, "", { property: opt.flag, values });
        }
        else ffmpegTypeMap["<string>"](node, opt);
    },

    "<bool>": (node, opt) => {
        const values = ["", "true", "false"];
        node.addProperty(opt.flag, "", "enum", { values });
        node.addWidget("combo", opt.flag, "", { property: opt.flag, values });
    },
    "<boolean>": (node, opt) => ffmpegTypeMap["<bool>"](node, opt),

    "<int>": (node, opt) => {
        node.addProperty(opt.flag, "", "string");
        node.addWidget("text", opt.flag, "", { property: opt.flag });
    },
    "<int64>": (node, opt) => ffmpegTypeMap["<int>"](node, opt),
    "<uint64>": (node, opt) => ffmpegTypeMap["<int>"](node, opt),

    "<float>": (node, opt) => {
        node.addProperty(opt.flag, "", "string");
        node.addWidget("text", opt.flag, "", { property: opt.flag });
    },
    "<double>": (node, opt) => ffmpegTypeMap["<float>"](node, opt),

    "<string>": (node, opt) => {
        node.addProperty(opt.flag, "", "string");
        node.addWidget("text", opt.flag, "", { property: opt.flag });
    },

    "<rational>": (node, opt) => {
        node.addProperty(opt.flag, "", "string");
        node.addWidget("text", opt.flag, "", { property: opt.flag });
    },

    "<duration>": (node, opt) => {
        node.addProperty(opt.flag, "", "string");
        node.addWidget("text", opt.flag, "", { property: opt.flag });
    },

    "<image_size>": (node, opt) => {
        node.addProperty(opt.flag, "", "string");
        node.addWidget("text", opt.flag, "", { property: opt.flag });
    },

    "<pix_fmt>": (node, opt) => {
        if(opt.values) {
            let values = [""].concat(opt.values);
            node.addProperty(opt.flag, "", "enum", { values });
            node.addWidget("combo", opt.flag, "", { property: opt.flag, values });
        }
        else ffmpegTypeMap["<string>"](node, opt);
    },

    "<sample_fmt>": (node, opt) => {
        if(opt.values) {
            let values = [""].concat(opt.values);
            node.addProperty(opt.flag, "", "enum", { values });
            node.addWidget("combo", opt.flag, "", { property: opt.flag, values });
        }
        else ffmpegTypeMap["<string>"](node, opt);
    },

    "<color>": (node, opt) => {
        node.addProperty(opt.flag, "", "string");
        node.addWidget("text", opt.flag, "", { property: opt.flag });
    },

    "<channel_layout>": (node, opt) => {
        if(opt.values) {
            let values = [""].concat(opt.values);
            node.addProperty(opt.flag, "", "enum", { values });
            node.addWidget("combo", opt.flag, "", { property: opt.flag, values });
        }
        else ffmpegTypeMap["<string>"](node, opt);
    }
};

function make_io_nodes() {

    function ffstream() {
        this.serialize_widgets = true;

        this.addInput("n-streams",graph_consts.N_STREAMS);
        this.addOutput("stream",graph_consts.MAP_STREAM);
        var types = ["id", "type", "name", "language", "program", "custom"];
        this.addProperty("Select by", "id", "enum", { values: types });

        this.addWidget("combo", "Select by", "id", { property: "Select by", values: types });
        this.onPropertyChanged("Select by", "id");

        this.title = "stream selector";
        this.desc = "Selects specific streams from inputs or filters.<br>\
        Used to map video/audio/subtitle streams (-map).<br>\
        Also links filters or encoder flags to target streams (e.g. -b:v, -b:a).<br>\
        Selection modes: by id, type, name, language, program, or custom map.";
    }

    ffstream.prototype.onExecute = function () {
        if (window.global_ffmpeg.selected_only && !this.is_selected) { return; }

        var s = this.getInputOrProperty("n-streams");
        var stream_type = this.getInputOrProperty("Type");
        var stream_id = this.getInputOrProperty("Id");
        var stream_name = this.getInputOrProperty("Name");
        var stream_lang = this.getInputOrProperty("Language");
        var program_id = this.getInputOrProperty("Program");
        var custom_map = this.getInputOrProperty("Custom");

        var result = "";
        var type =graph_consts.ST_RAW;

        switch (this.properties["Select by"]) {
            case "name":
                if (stream_name) {
                    result = stream_name; // must be a valid FFmpeg label like "v0"
                    type =graph_consts.ST_PROC;
                }
                break;
            case "language":
                if (stream_lang && (s && s.type ==graph_consts.N_INPUT)) {
                    result = s.id +":m:language:" + stream_lang;
                }
                break;
            case "type":
                if (stream_type !== undefined) {
                    result += (s && s.type ==graph_consts.N_INPUT) ? s.id : "";
                    switch(stream_type) {
                        case "video": result += `:v`; break;
                        case "audio": result += `:a`; break;
                        case "subtitle": result += `:s`; break;
                        case "data": result += `:d`; break;
                        case "attachment": result += `:t`; break;
                    }

                    result += stream_id ? `:${stream_id}` : "";
                }
                break;
            case "id":
                if (stream_id !== undefined && (s && s.type ==graph_consts.N_INPUT) ) {
                    result = s.id + ":" + stream_id;
                }
                break;
            case "program":
                if (program_id !== undefined && program_id !== "" && (s && s.type ==graph_consts.N_INPUT)) {
                    result = s.id + ":p:" + program_id;
                }
                break;
            case "custom":
                if (custom_map) {
                    result = custom_map;
                }
                break;
            default:
                break;
        }

        // filter node integration: must use name
        if (s && s.type ==graph_consts.N_FILTER) {
            if (this.properties["Select by"] !== "name" || !stream_name) {
                addLogEntry("error", "Stream selector after filters must use 'name' selection");
            } else {
                window.global_ffmpeg.filters[s.id] += "[" + result + "]";
            }
        }

        this.setOutputData(0, {
            data: result,
            type: type
        });
    };

    ffstream.prototype.onPropertyChanged = function (name, v) {
        if (name == "Select by") {
            this.widgets = this.widgets.filter(function (value) {
                return value.name === "Select by";
            });

            // clear old props
            delete this.properties.Id;
            delete this.properties.Type;
            delete this.properties.Name;
            delete this.properties.Language;
            delete this.properties.Program;
            delete this.properties.Custom;

            switch (v) {
                case "id":
                    this.addProperty("Id", "0");
                    this.addWidget("text", "Id", "0", { property: "Id" });
                    break;
                case "type":
                    var types = ["video", "audio", "subtitle", "data", "attachment"];
                    this.addProperty("Type", types[0], "enum", { values: types });
                    this.addWidget("combo", "Type", types[0], { property: "Type", values: types });
                    this.addProperty("Id", "");
                    this.addWidget("text", "Id", "", { property: "Id" });
                    break;
                case "name":
                    this.addProperty("Name", "");
                    this.addWidget("text", "Name", "", { property: "Name" });
                    break;
                case "language":
                    this.addProperty("Language", "eng");
                    this.addWidget("text", "Language", "eng", { property: "Language" });
                    break;
                case "program":
                    this.addProperty("Program", "1");
                    this.addWidget("text", "Program", "1", { property: "Program" });
                    break;
                case "custom":
                    this.addProperty("Custom", "");
                    this.addWidget("text", "Custom", "", { property: "Custom" });
                    break;
            }

            this.setSize(this.computeSize());
            this.setDirtyCanvas(true);
        }
    };

    ffstream.title = "stream selector";
    LiteGraph.registerNodeType("ffmpeg/stream selector", ffstream);


    function ffinput() {
        this.serialize_widgets = true;

        this.addInput("globals",graph_consts.IO_OPTION);
        this.addInput("dec:v",graph_consts.DECODER);
        this.addInput("dec:a",graph_consts.DECODER);
        this.addInput("demuxer", graph_consts.FORMAT);
        this.addOutput("n-streams",graph_consts.N_STREAMS);

        this.addProperty("src_path", "");
        this.str = "";
        this.mediaInfoLines = []; // Store processed lines
        const that = this;

        // --- Path text field ---
        this.pathWidget = this.addWidget("text", "path", "", { property: "src_path" });

        // --- Select button ---
        this.selectBtn = this.addWidget("button", "Select", "", () => {
            open({}).then((filePath) => {
                if(filePath) {
                    that.properties.src_path = filePath;
                    that.pathWidget.value = that.properties.src_path;

                    // reset media info
                    that.str = "";
                    that.mediaInfoLines = [];
                    that.getInfoBtn.disabled = !filePath;
                    that.updateNodeSize();
                }
            });
        });

        // --- Get media info button (disabled initially) ---
        this.getInfoBtn = this.addWidget("button", "Get media info", "", () => {
            if (!that.properties.src_path) return;

            invoke("get_mediainfo_request", {
                path: that.properties.src_path,
                ffmpeg: window.FFMPEG_BIN,
                env: window.FFMPEG_ENV
            }).then((data) => {
                that.str = "";
                that.mediaInfoLines = [];
                
                data.info_arr.forEach((item) => {
                    if (item.length > 150) item = item.substr(0, 150) + "...";
                    that.str += item + "\n";
                    that.mediaInfoLines.push(item);
                });
                
                that.updateNodeSize();
                that.setDirtyCanvas(true);
            }).catch((error) => {
                console.error("Error getting media info:", error);
                that.str = "Error retrieving media info";
                that.mediaInfoLines = ["Error retrieving media info"];
                that.updateNodeSize();
                that.setDirtyCanvas(true);
            });
        });
        this.getInfoBtn.disabled = true;

        this.title = "IN";
        this.desc = "Input source node.<br>\
        Supports file paths or wildcards (*) for batch processing.<br>\
        Each matching file becomes a separate input (-i).<br>\
        Use 'Get media info' to inspect streams and formats.";

        // Force initial size in LiteGraph
        this.setSize(this.computeSize());
        this.setDirtyCanvas(true);
    }
    // --- Serialization ---
    ffinput.prototype.onSerialize = function(o) {
        o.mediaInfoText = this.str;
        o.mediaInfoLines = this.mediaInfoLines;
    };

    ffinput.prototype.onConfigure = function(o) {
        if (o.mediaInfoText !== undefined) {
            this.str = o.mediaInfoText;
        }
        if (o.mediaInfoLines !== undefined) {
            this.mediaInfoLines = o.mediaInfoLines || [];
        }
        
        // Update size after loading media info
        this.updateNodeSize();
        this.setDirtyCanvas(true);
    };
    // --- Execution ---
    ffinput.prototype.onExecute = function () {
        if (window.global_ffmpeg.selected_only && !this.is_selected) { return; }

        const g = this.getInputOrProperty("globals");
        const d = this.getInputOrProperty("demuxer");
        const str = this.getInputOrProperty("src_path");
        const dec_a = this.getInputOrProperty("dec:a");
        const dec_v = this.getInputOrProperty("dec:v");

        window.global_ffmpeg.inputs = window.global_ffmpeg.inputs || [];
        window.global_ffmpeg.inputs.push(
            (dec_a ? "-c:a " + dec_a + " " : "") +
            (dec_v ? "-c:v " + dec_v + " " : "") +
            (d ? d + " " : "") +
            (g ? g + " " : "") +
            "-i " + str
        );

        this.setOutputData(0, {
            type:graph_consts.N_INPUT,
            id: window.global_ffmpeg.inputs.length - 1
        });
    };

    ffinput.prototype.updateNodeSize = function () {
        let default_size = this.computeSize();

        let newWidth = default_size[0];
        let newHeight = default_size[1];

        if (this.mediaInfoLines && this.mediaInfoLines.length > 0) {
            // Calculate size based on content
            const ctx = document.createElement('canvas').getContext('2d');
            ctx.font = "10px Arial";
            
            let maxWidth = 0;
            for (let line of this.mediaInfoLines) {
                const textWidth = ctx.measureText(line).width;
                if (textWidth > maxWidth) {
                    maxWidth = textWidth;
                }
            }
            
            newWidth = Math.max(default_size[0], maxWidth + 40); // padding
            newHeight = default_size[1] + (this.mediaInfoLines.length * 12) + 10; // line height + padding
        }

        // Always update size using LiteGraph's method
        this.setSize([newWidth, newHeight]);
    };

    // --- Draw media info ---
    ffinput.prototype.onDrawForeground = function (ctx) {
        if (this.flags.collapsed) return;

        if (this.mediaInfoLines && this.mediaInfoLines.length > 0) {
            ctx.save();
            
            // Set text properties
            ctx.fillStyle = "#AAA";
            ctx.shadowColor = "transparent";
            ctx.font = "10px Arial";
            ctx.textAlign = "left";

            const startY = this.computeSize()[0] - 50; // Moved down to avoid button overlap
            const lineHeight = 12;
            const padding = 10;
            const textHeight = this.mediaInfoLines.length * lineHeight;

            // Draw background box
            ctx.fillStyle = "rgba(0,0,0,0.25)";
            ctx.fillRect(10, startY, this.size[0] - 20, textHeight + padding);
            
            // Draw text
            ctx.fillStyle = "#AAA";
            for (let i = 0; i < this.mediaInfoLines.length; i++) {
                ctx.fillText(this.mediaInfoLines[i], 15, startY + 15 + (i * lineHeight));
            }
            
            ctx.restore();
        }
    };

    // --- Handle property changes ---
    ffinput.prototype.onPropertyChanged = function(name, value) {
        if (name === "src_path") {
            this.pathWidget.value = value;
            this.getInfoBtn.disabled = !value;
            if (!value) {
                this.str = "";
                this.mediaInfoLines = [];
                this.updateNodeSize();
                this.setDirtyCanvas(true);
            }
        }
    };

    ffinput.title = "input";
    LiteGraph.registerNodeType("ffmpeg/input", ffinput);


    function ffoutput() {
        this.serialize_widgets = true;

        this.addInput("globals",graph_consts.IO_OPTION);
        this.addInput("enc:v",graph_consts.ENCODER);
        this.addInput("enc:a",graph_consts.ENCODER);
        this.addInput("muxer", graph_consts.FORMAT);
        this.addInput("stream",graph_consts.MAP_STREAM);

        this.addProperty("dst_path", "");
        this.pathWidget = this.addWidget("text", "path", "", { property: "dst_path" });

        var that = this;
        this.addWidget("button", "Select", "", function (v) {
            save({ /*defaultPath: "", filters: [{ name: "Text file", extensions: ["txt"] }]*/ })
                .then((filePath) => {
                    if(filePath) {
                        that.properties.dst_path = filePath;
                        that.pathWidget.value = that.properties.dst_path;
                    }
            }).catch((err) => addLogEntry('error', `Failed to select target file path: ` + err) );
        });
        this.title = "OUT";
        this.desc = "Output destination node.<br>\
        Combines streams, encoders, muxer, and global options into one output file.<br>\
        Supports placeholders: {name}, {index}, {hash}, or * in filenames.<br>\
        If no placeholder is used, {name} is auto-injected before extension.";
    }
    ffoutput.prototype.onExecute = function () {
        if (window.global_ffmpeg.selected_only && !this.is_selected) { return; }

        var streams = "";
        for (var i = 0; i < this.inputs.length; i++) {
            if (this.inputs[i].name !== "stream") continue;
            var stream = this.getInputData(i);
            if (!stream) continue;

            if ('data' in stream && 'type' in stream) {
                if (!stream.data) {}
                else if (stream.type ==graph_consts.ST_PROC) streams += " -map [" + stream.data + "]";
                else streams += " -map " + stream.data;
            }
            else throw "not implemented";

        }
        var g = this.getInputOrProperty("globals")
        var m = this.getInputOrProperty("muxer")
        var enc_a = this.getInputOrProperty("enc:a");
        var enc_v = this.getInputOrProperty("enc:v");
        var path = this.getInputOrProperty("dst_path");
        window.global_ffmpeg.outputs = window.global_ffmpeg.outputs ? window.global_ffmpeg.outputs : [];
        window.global_ffmpeg.outputs.push(streams + " " + (m ? m + " " : "") +
            (g ? g + " " : "") +
            (enc_a ? "-c:a " + enc_a + " " : "") +
            (enc_v ? "-c:v " + enc_v + " " : "") +
            path);
    };
    ffoutput.prototype.onDrawForeground = function (ctx) {

        var free_slots = 0;
        this.inputs.forEach(element => {
            if (element.type ==graph_consts.MAP_STREAM && element.link == null)
                free_slots++;
        });
        free_slots--;
        if (free_slots > 0) {
            for (var i = 0; i < this.inputs.length; i++) {
                if (this.inputs[i].type ==graph_consts.MAP_STREAM && this.inputs[i].link == null && free_slots > 0) {
                    this.removeInput(i);
                    free_slots--;
                }
            }
        }
        else if (free_slots < 0) this.addInput("stream",graph_consts.MAP_STREAM);
    }
    ffoutput.title = "output";
    LiteGraph.registerNodeType("ffmpeg/output", ffoutput);
}

function make_nodes(nodes) {
    nodes.forEach((item) => {
        var category = "ffmpeg/";

        if (item["is_av_option"]) {
            if (item["pcategory"]) category = category + item["pcategory"] + "/";
            if (item["category"].includes("S")) category = category + "subtitles/";
            if (item["category"].includes("VA")) category = category + "all/";
            else if (item["category"].includes("V")) category = category + "video/";
            else if (item["category"].includes("A")) category = category + "audio/";
            else if (item["category"].includes("E") || item["category"].includes("D")) category = category + "all/";

            var fn = { [item["name"]]: function () {
                    this.serialize_widgets = true;

                    if (item["pcategory"] == 'decoders') {
                        this.addOutput("codec",graph_consts.DECODER);
                        this.node_type =graph_consts.N_DECODER;
                    }
                    else if (item["pcategory"] == 'encoders') {
                        this.addOutput("codec",graph_consts.ENCODER);
                        this.node_type =graph_consts.N_ENCODER;
                    }
                    else if (item["pcategory"] == 'filters') {
                        this.addInput("stream",graph_consts.MAP_STREAM); 
                        this.addOutput("n-streams",graph_consts.N_STREAMS);
                        this.node_type =graph_consts.N_FILTER;
                    }
                    else if (item["pcategory"] == 'demuxers') {
                        this.addOutput("demuxer", graph_consts.FORMAT);
                        this.node_type =graph_consts.N_FORMAT;
                    }
                    else if (item["pcategory"] == 'muxers') {
                        this.addOutput("muxer", graph_consts.FORMAT);
                        this.node_type =graph_consts.N_FORMAT;
                    }

                    if (item["category"].includes("V")) category = category + "video/";
                    if (item["category"].includes("A")) category = category + "audio/";

                    this.json_data = item;
                    for (let opt of this.json_data["options"]) {
                        let handler = ffmpegTypeMap[opt.type];
                        if (handler) {
                            handler(this, opt);
                        } else {
                            // Fallback
                            this.addProperty(opt.flag, "", "string");
                            this.addWidget("text", opt.flag, "", { property: opt.flag });
                        }
                    }

                    this.desc = "";
                    for (var i = 0; i < this.json_data["full_desc"].length; i++) this.desc = this.desc + "<br>" + this.json_data["full_desc"][i];
                    this.name = this.json_data["name"];

                }
            }[item["name"]];

            fn.title = item["name"];
            if (item["category"] !== "") fn.title = fn.title + ` [${item["category"]}]`;

            fn.prototype.onExecute = function () {
                if (window.global_ffmpeg.selected_only && !this.is_selected) { return; }
                
                let connected = false;
                for (var i = 0; i < this.outputs.length; i++) {
                    if(this.outputs[i].links) connected = true;
                }
                if(!connected) return;

                switch (this.node_type) {
                    case graph_consts.N_FILTER: {
                        exec_filter(this);
                        break;
                    }
                    case graph_consts.N_DECODER:
                    case graph_consts.N_ENCODER: {
                        exec_codec(this);
                        break;
                    }
                    case graph_consts.N_FORMAT: {
                        exec_format(this);
                        break;
                    }
                }
            };

            fn.prototype.onDrawForeground = function (ctx) {
                if (item["pcategory"] == 'filters') {
                    var free_slots = 0;
                    this.inputs.forEach(element => {
                        if (element.type ==graph_consts.MAP_STREAM && element.link == null)
                            free_slots++;
                    });
                    free_slots--;
                    if (free_slots > 0) {
                        for (var i = 0; i < this.inputs.length; i++) {
                            if (this.inputs[i].type ==graph_consts.MAP_STREAM && this.inputs[i].link == null && free_slots > 0) {
                                this.removeInput(i);
                                free_slots--;
                            }
                        }
                    }
                    else if (free_slots < 0) this.addInput("stream",graph_consts.MAP_STREAM);
                }
            }

            LiteGraph.registerNodeType(category + item["name"], fn);
        }
        else { 
            category = "ffmpeg/general/" + item["name"] + "/";
            item["options"].forEach(opt => {

                var fn = { [opt["flag"]]: function () {
                        this.serialize_widgets = true;
                        this.addInput("globals",graph_consts.IO_OPTION);
                        if(!opt["no_args"]) this.addInput("stream",graph_consts.MAP_STREAM);
                        this.addOutput("globals",graph_consts.IO_OPTION);

                        if (opt["enum_vals"].length > 0) {
                            opt["enum_vals"].push("");
                            this.addProperty(opt["flag"], "", "enum", { values: opt["enum_vals"] });
                            this.addWidget("combo", opt["flag"], "", { property: opt["flag"], values: opt["enum_vals"] });
                        } else { 
                            this.addProperty("flag", opt["flag"]); 
                        }

                        if(!opt["no_args"]) {
                            this.addWidget("text", opt["flag"], "",  { property: opt["flag"] }); 
                        } 
                        
                        this.name = opt["flag"];
                        this.desc = opt.desc;
                    }
                }[opt["flag"]];

                fn.prototype.onExecute = function () {
                    if (window.global_ffmpeg.selected_only && !this.is_selected) { return; }

                    let connected = false;
                    for (var i = 0; i < this.outputs.length; i++) {
                        if(this.outputs[i].links) connected = true;
                    }
                    if(!connected) return;

                    var g = this.getInputOrProperty("globals");
                    
                    var stream_spec = this.getInputOrProperty("stream");
                    stream_spec = stream_spec ? stream_spec.data : "";
                    if(stream_spec) stream_spec = ":" + stream_spec.split(":").slice(1).join(":");

                    var result = "";
                    
                    if(this.widgets) {
                        this.widgets.forEach(item => {
                            if (item.value) result += item.name + stream_spec + " " + item.value;
                        });
                    } else {
                        const keys = Object.keys(this.properties);
                        keys.forEach(key => {
                            result += this.properties[key] + " ";
                        });
                    }
                  
      
                    this.setOutputData(0, (g ? g + " " : "") + result);
                };

                fn.title = opt["flag"];
                LiteGraph.registerNodeType(category + opt["flag"], fn);
            });
        }
    });
}

function exec_filter(node) {
    var result = "";
    for (var i = 0; i < node.inputs.length; i++) {
        var str = node.getInputData(i);
        if (str != undefined) result += "[" + str.data + "]";
    }
    result += node.name;

    var opt = "";
    if (node.widgets) node.widgets.forEach(item => {
        if (item.value) opt += item.name + "=" + item.value + ":";
    })
    if (opt.slice(-1) == ":") opt = opt.slice(0, -1);
    if (opt !== "") result += "=" + opt;

    window.global_ffmpeg.filters = window.global_ffmpeg.filters ? window.global_ffmpeg.filters : [];
    window.global_ffmpeg.filters.push(result);

    node.setOutputData(0, {
        type:graph_consts.N_FILTER,
        id: window.global_ffmpeg.filters.length - 1
    });
}

function exec_format(node) {
    var result = "-f " + node.name;
    if (node.widgets) node.widgets.forEach(item => {
        if (item.value) result += " " + item.name + " " + item.value;
    });

    node.setOutputData(0, result);
}

function exec_codec(node) {
    var result = node.name;
    if (node.widgets) node.widgets.forEach(item => {
        if (item.value) result += " " + item.name + " " + item.value;
    });

    node.setOutputData(0, result);
}


export { make_io_nodes, make_nodes };
