//! QBCAM shared-memory ring buffer — spec §10.2 / packages/shm/SPEC.md.
//!
//! Header (256 B) + N slots, each slot = 32 B slotHeader + pixels.
//! `writeSeq` is the only atomic the writer publishes; readers keep private
//! `readSeq` counters in the header (per-reader slot 0..7).
//!
//! POSIX only (macOS/Linux) in v0; Windows uses named file mappings and is a
//! documented gap until M3 (spec NFR-06 covers Win later).

#![allow(clippy::result_large_err)]

use std::io;
use std::sync::atomic::{AtomicU64, Ordering};

pub const MAGIC: u32 = 0x5142_4D31; // "QBM1"
pub const VERSION: u32 = 1;
pub const HEADER_BYTES: usize = 256;
pub const SLOT_HEADER_BYTES: usize = 32;
pub const MAX_READERS: usize = 8;
pub const MAX_NAME_BYTES: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum PixelFormat {
    Bgra = 1,
    Nv12 = 2,
    Rgb24 = 3,
}

impl PixelFormat {
    pub fn from_u32(v: u32) -> Option<Self> {
        match v {
            1 => Some(Self::Bgra),
            2 => Some(Self::Nv12),
            3 => Some(Self::Rgb24),
            _ => None,
        }
    }

    /// Bytes per pixel for packed formats; None for planar (NV12).
    pub fn bpp(self) -> Option<usize> {
        match self {
            Self::Bgra => Some(4),
            Self::Rgb24 => Some(3),
            Self::Nv12 => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameMeta {
    pub seq: u64,
    pub ts_ns: u64,
    pub flags: u32,
    pub face_count: u32,
}

#[derive(Debug)]
pub struct ShmError(io::Error);

impl std::fmt::Display for ShmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "shm error: {}", self.0)
    }
}

impl std::error::Error for ShmError {}

impl From<io::Error> for ShmError {
    fn from(e: io::Error) -> Self {
        Self(e)
    }
}

pub type ShmResult<T> = Result<T, ShmError>;

/// Raw pointer wrapper over one shm mapping. Not Send-safe across threads by
/// itself; wrap in the handle types below.
struct Mapping {
    ptr: *mut u8,
    len: usize,
}

unsafe impl Send for Mapping {}
unsafe impl Sync for Mapping {}

impl Mapping {
    fn open(name: &str, create: bool, size: Option<usize>) -> ShmResult<Self> {
        if name.is_empty() || name.len() > MAX_NAME_BYTES || !name.starts_with('/') {
            return Err(ShmError(io::Error::new(
                io::ErrorKind::InvalidInput,
                "ring name must start with '/' and be <= 128 bytes",
            )));
        }
        let c = std::ffi::CString::new(name).map_err(|_| {
            ShmError(io::Error::new(io::ErrorKind::InvalidInput, "bad ring name"))
        })?;
        let flags = if create {
            libc::O_CREAT | libc::O_RDWR
        } else {
            libc::O_RDWR
        };
        let fd = unsafe { libc::shm_open(c.as_ptr(), flags, 0o600) };
        if fd < 0 {
            return Err(ShmError(io::Error::last_os_error()));
        }
        if let Some(sz) = size {
            if unsafe { libc::ftruncate(fd, sz as libc::off_t) } != 0 {
                unsafe { libc::close(fd) };
                return Err(ShmError(io::Error::last_os_error()));
            }
        }
        // For attach, discover the size from the fd.
        let len = match size {
            Some(sz) => sz,
            None => {
                let mut st: libc::stat = unsafe { std::mem::zeroed() };
                if unsafe { libc::fstat(fd, &mut st) } != 0 {
                    unsafe { libc::close(fd) };
                    return Err(ShmError(io::Error::last_os_error()));
                }
                st.st_size as usize
            }
        };
        let prot = libc::PROT_READ | libc::PROT_WRITE;
        let ptr = unsafe { libc::mmap(std::ptr::null_mut(), len, prot, libc::MAP_SHARED, fd, 0) };
        unsafe { libc::close(fd) };
        if ptr == libc::MAP_FAILED {
            return Err(ShmError(io::Error::last_os_error()));
        }
        Ok(Self { ptr: ptr.cast(), len })
    }

    fn unlink(name: &str) -> ShmResult<()> {
        let c = std::ffi::CString::new(name).map_err(|_| {
            ShmError(io::Error::new(io::ErrorKind::InvalidInput, "bad ring name"))
        })?;
        if unsafe { libc::shm_unlink(c.as_ptr()) } != 0 {
            return Err(ShmError(io::Error::last_os_error()));
        }
        Ok(())
    }
}

impl Drop for Mapping {
    fn drop(&mut self) {
        unsafe { libc::munmap(self.ptr.cast(), self.len) };
    }
}

// header field offsets (see SPEC.md)
const OFF_MAGIC: usize = 0;
const OFF_VERSION: usize = 4;
const OFF_SLOTS: usize = 8;
const OFF_SLOT_BYTES: usize = 12;
const OFF_WIDTH: usize = 16;
const OFF_HEIGHT: usize = 20;
const OFF_FORMAT: usize = 24;
const OFF_WRITE_SEQ: usize = 32;
const OFF_READ_SEQ: usize = 40; // MAX_READERS * 8 bytes

#[inline]
fn hdr_u32(ptr: *mut u8, off: usize) -> u32 {
    unsafe { (ptr.add(off) as *const u32).read_volatile() }
}

#[inline]
fn hdr_u64(ptr: *mut u8, off: usize) -> u64 {
    unsafe { (ptr.add(off) as *const u64).read_volatile() }
}

#[inline]
fn atom_u64(map: &Mapping, off: usize) -> &AtomicU64 {
    unsafe { &*(map.ptr.add(off) as *const AtomicU64) }
}

#[inline]
fn hdr_set_u32(ptr: *mut u8, off: usize, v: u32) {
    unsafe { (ptr.add(off) as *mut u32).write_volatile(v) }
}

#[inline]
fn hdr_set_u64(ptr: *mut u8, off: usize, v: u64) {
    unsafe { (ptr.add(off) as *mut u64).write_volatile(v) }
}

pub struct RingInfo {
    pub name: String,
    pub slots: u32,
    pub slot_bytes: u32,
    pub width: u32,
    pub height: u32,
    pub format: PixelFormat,
    pub pixels_per_slot: usize,
}

/// Create (or reuse-empty) a ring. Caller decides slots; slot_bytes must fit
/// the chosen frame format. Returns info for consumers to validate against.
pub fn create_ring(name: &str, slots: u32, slot_bytes: u32, width: u32, height: u32, format: PixelFormat) -> ShmResult<RingInfo> {
    if slots == 0 || slots > 64 {
        return Err(ShmError(io::Error::new(io::ErrorKind::InvalidInput, "slots must be 1..=64")));
    }
    let total = HEADER_BYTES + slots as usize * slot_bytes as usize;
    let map = Mapping::open(name, true, Some(total))?;
    let p = map.ptr;
    // Initialize header only if it's fresh (magic absent). Concurrent creators
    // are not supported (supervisor serializes creation).
    if hdr_u32(p, OFF_MAGIC) != MAGIC {
        for i in 0..total {
            unsafe { p.add(i).write_volatile(0) };
        }
        hdr_set_u32(p, OFF_MAGIC, MAGIC);
        hdr_set_u32(p, OFF_VERSION, VERSION);
        hdr_set_u32(p, OFF_SLOTS, slots);
        hdr_set_u32(p, OFF_SLOT_BYTES, slot_bytes);
        hdr_set_u32(p, OFF_WIDTH, width);
        hdr_set_u32(p, OFF_HEIGHT, height);
        hdr_set_u32(p, OFF_FORMAT, format as u32);
        atom_u64(&map, OFF_WRITE_SEQ).store(0, Ordering::Release);
    }
    info_from(&map, name)
}

pub fn unlink_ring(name: &str) -> ShmResult<()> {
    Mapping::unlink(name)
}

fn info_from(map: &Mapping, name: &str) -> ShmResult<RingInfo> {
    let p = map.ptr;
    if hdr_u32(p, OFF_MAGIC) != MAGIC {
        return Err(ShmError(io::Error::new(
            io::ErrorKind::InvalidData,
            "not a QBM1 ring (bad magic)",
        )));
    }
    let slots = hdr_u32(p, OFF_SLOTS);
    let slot_bytes = hdr_u32(p, OFF_SLOT_BYTES);
    let format = PixelFormat::from_u32(hdr_u32(p, OFF_FORMAT)).ok_or_else(|| {
        ShmError(io::Error::new(io::ErrorKind::InvalidData, "unknown pixel format"))
    })?;
    Ok(RingInfo {
        name: name.to_string(),
        slots,
        slot_bytes,
        width: hdr_u32(p, OFF_WIDTH),
        height: hdr_u32(p, OFF_HEIGHT),
        format,
        pixels_per_slot: slot_bytes as usize - SLOT_HEADER_BYTES,
    })
}

/// Single-producer writer. The producer calls [`write_frame`] with the full
/// pixel payload; publish order is: payload → slotHeader.seq → writeSeq.
pub struct RingWriter {
    map: Mapping,
    info: RingInfo,
}

unsafe impl Send for RingWriter {}

impl RingWriter {
    pub fn attach(name: &str) -> ShmResult<Self> {
        let map = Mapping::open(name, false, None)?;
        let info = info_from(&map, name)?;
        Ok(Self { map, info })
    }

    pub fn info(&self) -> &RingInfo {
        &self.info
    }

    /// Write one frame. `pixels.len()` must equal `pixels_per_slot`.
    /// Returns the published seq number.
    pub fn write_frame(&mut self, pixels: &[u8], ts_ns: u64, flags: u32, face_count: u32) -> ShmResult<u64> {
        if pixels.len() != self.info.pixels_per_slot {
            return Err(ShmError(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "payload {} != pixels_per_slot {}",
                    pixels.len(),
                    self.info.pixels_per_slot
                ),
            )));
        }
        let p = self.map.ptr;
        let seq = atom_u64(&self.map, OFF_WRITE_SEQ).fetch_add(1, Ordering::AcqRel) + 1;
        let slot = ((seq - 1) % self.info.slots as u64) as usize;
        let base = unsafe { p.add(HEADER_BYTES + slot * self.info.slot_bytes as usize) };
        let px = unsafe { base.add(SLOT_HEADER_BYTES) };
        unsafe { std::ptr::copy_nonoverlapping(pixels.as_ptr(), px, pixels.len()) };
        // slot header: seq u64, ts_ns u64, flags u32, faceCount u32 — seq last
        hdr_set_u64(base, 8, ts_ns);
        hdr_set_u32(base, 16, flags);
        hdr_set_u32(base, 20, face_count);
        hdr_set_u64(base, 0, seq); // completeness marker
        Ok(seq)
    }
}

/// Reader policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadPolicy {
    /// Skip to the newest complete frame (live pipeline).
    LatestWins,
    /// Consume every seq in order, polling until available (recorder/offline).
    NoDrop,
}

pub struct Frame {
    pub meta: FrameMeta,
    pub pixels: Vec<u8>,
}

pub struct RingReader {
    map: Mapping,
    info: RingInfo,
    reader_idx: usize,
    policy: ReadPolicy,
    last_seq: u64,
}

unsafe impl Send for RingReader {}
unsafe impl Sync for RingReader {}

impl RingReader {
    /// Attach as reader `reader_idx` (0..8). Each attached reader gets a
    /// private readSeq slot in the header.
    pub fn attach(name: &str, reader_idx: usize, policy: ReadPolicy) -> ShmResult<Self> {
        if reader_idx >= MAX_READERS {
            return Err(ShmError(io::Error::new(
                io::ErrorKind::InvalidInput,
                "reader_idx must be 0..8",
            )));
        }
        let map = Mapping::open(name, false, None)?;
        let info = info_from(&map, name)?;
        let last_seq = atom_u64(&map, OFF_READ_SEQ + reader_idx * 8).load(Ordering::Acquire);
        Ok(Self { map, info, reader_idx, policy, last_seq })
    }

    pub fn info(&self) -> &RingInfo {
        &self.info
    }

    #[inline]
    fn publish_seq(&self) -> u64 {
        atom_u64(&self.map, OFF_WRITE_SEQ).load(Ordering::Acquire)
    }

    #[inline]
    fn persist_read(&self, seq: u64) {
        atom_u64(&self.map, OFF_READ_SEQ + self.reader_idx * 8).store(seq, Ordering::Release);
    }

    fn read_slot(&self, seq: u64) -> Option<Frame> {
        let slot = ((seq - 1) % self.info.slots as u64) as usize;
        let base = unsafe { self.map.ptr.add(HEADER_BYTES + slot * self.info.slot_bytes as usize) };
        // Completeness check first: a seq of 0 or != expected means the slot is
        // mid-write or overwritten.
        let hdr_seq = hdr_u64(base, 0);
        if hdr_seq != seq {
            return None;
        }
        let ts_ns = hdr_u64(base, 8);
        let flags = hdr_u32(base, 16);
        let face_count = hdr_u32(base, 20);
        let px = unsafe { base.add(SLOT_HEADER_BYTES) };
        let mut pixels = vec![0u8; self.info.pixels_per_slot];
        unsafe { std::ptr::copy_nonoverlapping(px, pixels.as_mut_ptr(), pixels.len()) };
        // Re-check seq after copy: if it changed, the writer overwrote us.
        if hdr_u64(base, 0) != seq {
            return None;
        }
        Some(Frame { meta: FrameMeta { seq, ts_ns, flags, face_count }, pixels })
    }

    /// Read per the attached policy. Returns None when nothing new is
    /// available (LatestWins) — callers poll. For NoDrop, returns the next
    /// missing frame or None if writer hasn't produced past last_seq.
    pub fn read(&mut self) -> Option<Frame> {
        let published = self.publish_seq();
        if published <= self.last_seq {
            return None;
        }
        match self.policy {
            ReadPolicy::LatestWins => {
                let want = published;
                match self.read_slot(want) {
                    Some(f) => {
                        self.last_seq = want;
                        self.persist_read(want);
                        Some(f)
                    }
                    None => {
                        // Slot mid-write or overwritten; retry on next poll.
                        None
                    }
                }
            }
            ReadPolicy::NoDrop => {
                let want = self.last_seq + 1;
                if want > published {
                    return None;
                }
                match self.read_slot(want) {
                    Some(f) => {
                        self.last_seq = want;
                        self.persist_read(want);
                        Some(f)
                    }
                    None => {
                        // Slot for `want` was overwritten (we're too far
                        // behind, more than N-1 frames): resync to latest.
                        tracing::warn!("no-drop reader too slow, resyncing to latest seq");
                        let latest = self.publish_seq();
                        if let Some(f) = self.read_slot(latest) {
                            self.last_seq = latest;
                            self.persist_read(latest);
                            return Some(f);
                        }
                        None
                    }
                }
            }
        }
    }

    pub fn last_seq(&self) -> u64 {
        self.last_seq
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    const W: u32 = 64;
    const H: u32 = 48;
    const FRAME: usize = (W * H * 4) as usize; // BGRA

    fn tmp_name() -> String {
        use std::sync::atomic::AtomicU32;
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        format!(
            "/qbcam.test.{:x}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            n
        )
    }

    #[test]
    fn create_and_validate_header() {
        let name = tmp_name();
        let info = create_ring(&name, 4, SLOT_HEADER_BYTES as u32 + FRAME as u32, W, H, PixelFormat::Bgra).unwrap();
        assert_eq!(info.slots, 4);
        assert_eq!(info.width, W);
        assert_eq!(info.format, PixelFormat::Bgra);
        unlink_ring(&name).unwrap();
    }

    #[test]
    fn write_then_latest_wins_read() {
        let name = tmp_name();
        create_ring(&name, 4, SLOT_HEADER_BYTES as u32 + FRAME as u32, W, H, PixelFormat::Bgra).unwrap();

        let mut writer = RingWriter::attach(&name).unwrap();
        let mut reader = RingReader::attach(&name, 0, ReadPolicy::LatestWins).unwrap();

        let mut px = vec![0u8; FRAME];
        for i in 0..10u64 {
            px[0] = i as u8;
            writer.write_frame(&px, i * 33_000_000, 0, 1).unwrap();
        }
        let f = reader.read().expect("frame");
        assert_eq!(f.meta.seq, 10);
        assert_eq!(f.pixels[0], 9);
        assert!(reader.read().is_none(), "nothing new after latest");
        unlink_ring(&name).unwrap();
    }

    #[test]
    fn no_drop_reads_every_frame() {
        let name = tmp_name();
        // Enough slots that a same-process slow reader never falls behind by N.
        create_ring(&name, 16, SLOT_HEADER_BYTES as u32 + FRAME as u32, W, H, PixelFormat::Bgra).unwrap();

        let wname = name.clone();
        let writer_thread = thread::spawn(move || {
            let mut writer = RingWriter::attach(&wname).unwrap();
            let mut px = vec![0u8; FRAME];
            for i in 0..7u8 {
                px[0] = i;
                writer.write_frame(&px, 0, 0, 0).unwrap();
                thread::sleep(std::time::Duration::from_micros(500));
            }
        });

        let mut reader = RingReader::attach(&name, 1, ReadPolicy::NoDrop).unwrap();
        let mut got: Vec<u8> = vec![];
        while got.len() < 7 {
            if let Some(f) = reader.read() {
                got.push(f.pixels[0]);
            } else {
                thread::sleep(std::time::Duration::from_micros(100));
            }
        }
        writer_thread.join().unwrap();
        assert_eq!(got, vec![0, 1, 2, 3, 4, 5, 6]);
        unlink_ring(&name).unwrap();
    }

    #[test]
    fn latest_wins_skips_stale() {
        let name = tmp_name();
        create_ring(&name, 4, SLOT_HEADER_BYTES as u32 + FRAME as u32, W, H, PixelFormat::Bgra).unwrap();
        let mut writer = RingWriter::attach(&name).unwrap();
        let mut reader = RingReader::attach(&name, 0, ReadPolicy::LatestWins).unwrap();
        let mut px = vec![0u8; FRAME];
        for i in 0..20u8 {
            px[0] = i;
            writer.write_frame(&px, 0, 0, 0).unwrap();
        }
        // Small ring: reader behind by > N slots may hit an overwritten slot;
        // policy is to keep polling until a complete latest frame is read.
        let mut attempts = 0;
        while reader.read().is_none() {
            attempts += 1;
            assert!(attempts < 1000, "never produced a frame");
            thread::sleep(std::time::Duration::from_micros(100));
        }
        assert_eq!(reader.last_seq(), 20);
        unlink_ring(&name).unwrap();
    }

    #[test]
    fn multiple_readers_independent() {
        let name = tmp_name();
        create_ring(&name, 4, SLOT_HEADER_BYTES as u32 + FRAME as u32, W, H, PixelFormat::Bgra).unwrap();
        let mut writer = RingWriter::attach(&name).unwrap();
        let mut r0 = RingReader::attach(&name, 0, ReadPolicy::LatestWins).unwrap();
        let mut r1 = RingReader::attach(&name, 1, ReadPolicy::LatestWins).unwrap();
        let px = vec![1u8; FRAME];
        writer.write_frame(&px, 0, 0, 0).unwrap();
        let f0 = r0.read().unwrap();
        let f1 = r1.read().unwrap();
        assert_eq!(f0.meta.seq, f1.meta.seq);
        unlink_ring(&name).unwrap();
    }

    #[test]
    fn rejects_wrong_payload_size() {
        let name = tmp_name();
        create_ring(&name, 2, SLOT_HEADER_BYTES as u32 + FRAME as u32, W, H, PixelFormat::Bgra).unwrap();
        let mut writer = RingWriter::attach(&name).unwrap();
        assert!(writer.write_frame(&vec![0u8; 10], 0, 0, 0).is_err());
        unlink_ring(&name).unwrap();
    }
}
