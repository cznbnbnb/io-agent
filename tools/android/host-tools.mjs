// Host OS differences only: executable suffixes and the Python launcher name.
export const WINDOWS=process.platform==='win32';
export const PYTHON=WINDOWS?'python':'python3';
export const exe=name=>WINDOWS?name+'.exe':name;
