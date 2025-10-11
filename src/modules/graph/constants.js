export const FORMAT = "fmt";
export const IO_OPTION = "ioopt";
export const N_STREAMS = "streams";
export const MAP_STREAM = "maps";
export const DECODER = "dec";
export const ENCODER = "enc";

// Node type constants
export const N_FILTER = 0;
export const N_ENCODER = 1;
export const N_DECODER = 2;
export const N_FORMAT = 3;
export const N_INPUT = 4;

// Stream type constants
export const ST_RAW = 0;
export const ST_PROC = 1;

// Regex patterns for command parsing
export const ERROR_REGEX = /(error|failed|invalid argument|cannot|matches no streams|No such file or directory|already exists)/i;
export const WARNING_REGEX = /(warning|deprecated|unknown)/i;
export const PROGRESS_REGEX = /^(frame|size)=\s*\S+/i;
