//! Synthetic "fake camera" — deterministic animated BGRA frames (gradient +
//! moving face-like blob). The spec's hermetic camera for tests and dev (§18).

pub struct FakeCamera {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    frame_index: u64,
}

impl FakeCamera {
    pub fn new(width: u32, height: u32, fps: f64) -> Self {
        Self { width, height, fps, frame_index: 0 }
    }

    /// Render the next frame into `out` (w*h*4 BGRA bytes). Returns ts_ns.
    pub fn next_frame(&mut self, out: &mut [u8]) -> u64 {
        let w = self.width as usize;
        let h = self.height as usize;
        let t = self.frame_index as f32 / self.fps.max(1.0) as f32;
        // moving face blob center
        let cx = w as f32 * (0.5 + 0.15 * (t * 0.7).sin());
        let cy = h as f32 * 0.45;
        let r = (h as f32 * 0.28).min(w as f32 * 0.28);
        for y in 0..h {
            for x in 0..w {
                let xf = x as f32;
                let yf = y as f32;
                // BGRA
                let i = (y * w + x) * 4;
                let (b, g, rr) = gradient(xf, yf, w as f32, h as f32, t);
                // face circle: warm tone
                let d = ((xf - cx).powi(2) + (yf - cy).powi(2)).sqrt();
                let (b, g, rr) = if d < r {
                    let shade = 1.0 - (d / r) * 0.15;
                    (200.0 * shade, 180.0 * shade, 220.0 * shade)
                } else {
                    (b, g, rr)
                };
                // eyes (two dark ellipses) + mouth line
                let eye_y = cy - r * 0.25;
                let eye_dx = r * 0.4;
                let near_eye = ((xf - (cx - eye_dx)) / (r * 0.18)).powi(2)
                    + ((yf - eye_y) / (r * 0.10)).powi(2)
                    < 1.0
                    || ((xf - (cx + eye_dx)) / (r * 0.18)).powi(2)
                        + ((yf - eye_y) / (r * 0.10)).powi(2)
                        < 1.0;
                let mouth = ((yf - (cy + r * 0.35)) / (r * 0.06)).powi(2) < 1.0
                    && (xf - cx).abs() < r * 0.5;
                let (b, g, rr) = if near_eye || mouth { (30.0, 30.0, 30.0) } else { (b, g, rr) };
                out[i] = b as u8;
                out[i + 1] = g as u8;
                out[i + 2] = rr as u8;
                out[i + 3] = 255;
            }
        }
        self.frame_index += 1;
        (self.frame_index as f64 * 1e9 / self.fps) as u64
    }

    pub fn frame_bytes(&self) -> usize {
        self.width as usize * self.height as usize * 4
    }
}

fn gradient(x: f32, y: f32, w: f32, h: f32, t: f32) -> (f32, f32, f32) {
    let u = x / w;
    let v = y / h;
    let wave = 0.5 + 0.5 * (t + u * 3.0 + v * 2.0).sin();
    (
        40.0 + 100.0 * u,
        40.0 + 80.0 * wave,
        60.0 + 120.0 * (1.0 - v),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_expected_size_and_animates() {
        let mut cam = FakeCamera::new(64, 48, 30.0);
        let mut a = vec![0u8; 64 * 48 * 4];
        let mut b = vec![0u8; 64 * 48 * 4];
        let ts0 = cam.next_frame(&mut a);
        let ts1 = cam.next_frame(&mut b);
        assert_eq!(a.len(), 64 * 48 * 4);
        assert_ne!(a, b, "frames must animate");
        assert!(ts1 > ts0);
        // alpha always opaque
        assert_eq!(a[3], 255);
    }

    #[test]
    fn face_blob_present() {
        let mut cam = FakeCamera::new(128, 96, 30.0);
        let mut f = vec![0u8; 128 * 96 * 4];
        cam.next_frame(&mut f);
        // center pixel should be face-tone (warm, > 150 red channel)
        let i = (48 * 128 + 64) * 4;
        assert!(f[i + 2] > 150, "center should be face-tone, got r={}", f[i + 2]);
    }
}
