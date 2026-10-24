// Probe attach: open an existing ring and print result (temporary tool)
use std::os::raw::{c_char, c_int};

extern "C" {
    fn shm_open(name: *const c_char, oflag: c_int, mode: c_int) -> c_int;
}

fn main() {
    let name = b"/qbcam.probe.rs\0";
    let fd = unsafe { shm_open(name.as_ptr().cast(), 0o2 /*O_RDWR*/, 0o600) };
    if fd >= 0 {
        println!("attach OK fd {fd}");
    } else {
        eprintln!("attach FAILED: {}", std::io::Error::last_os_error());
        std::process::exit(1);
    }
}
