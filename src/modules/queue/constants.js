// Regex patterns for command parsing
export const ERROR_REGEX = /(error|failed|invalid argument|cannot|matches no streams|No such file or directory|already exists)/i;
export const WARNING_REGEX = /(warning|deprecated|unknown)/i;
export const PROGRESS_REGEX = /^(frame|size)=\s*\S+/i;
