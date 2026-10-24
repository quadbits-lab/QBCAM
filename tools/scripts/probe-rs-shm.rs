// Probe: does a Rust-created shm object attach from Python? (temporary tool)
// Standalone: uses raw syscalls via inline extern, no libc crate needed.
use std::os::raw::{c_char, c_int, c_void};

extern "C" {
    fn shm_open(name: *const c_char, oflag: c_int, mode: c_int) -> c_int;
    fn shm_unlink(name: *const c_char) -> c_int;
    fn ftruncate(fd: c_int, len: i64) -> c_int;
}

fn main() {
    let name = b"/qbcam.probe.rs\0";
    unsafe { shm_unlink(name.as_ptr().cast()) };
    let fd = unsafe { shm_open(name.as_ptr().cast(), 0o1000 | 0o2 /*O_CREAT|O_RDWR*/, 0o600) };
    assert!(fd >= 0, "create failed: {}", std::io::Error::last_os_error());
    unsafe { ftruncate(fd, 4096) };
    println!("rust created /qbcam.probe.rs");
    std::thread::sleep(std::time::Duration::from_secs(3));
}
