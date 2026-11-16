//! Decode UTF-8 after a complete SSE event, never at arbitrary network chunk boundaries.
#[derive(Default)]
pub struct Events {
    bytes: Vec<u8>,
    output: usize,
}
impl Events {
    pub fn record_text(&mut self, text: &str) -> Result<(), String> {
        self.output += text.len();
        if self.output > 2 * 1024 * 1024 {
            return Err("AI response exceeds the text limit".into());
        }
        Ok(())
    }
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, String> {
        if self.bytes.len() + chunk.len() > 8 * 1024 * 1024 {
            return Err("AI stream buffer exceeds the size limit".into());
        }
        self.bytes.extend_from_slice(chunk);
        let mut result = Vec::new();
        loop {
            let lf = self
                .bytes
                .windows(2)
                .position(|b| b == b"\n\n")
                .map(|p| (p, 2));
            let crlf = self
                .bytes
                .windows(4)
                .position(|b| b == b"\r\n\r\n")
                .map(|p| (p, 4));
            let boundary = lf.into_iter().chain(crlf).min_by_key(|(offset, _)| *offset);
            let Some((end, delimiter)) = boundary else {
                break;
            };
            if end > 4 * 1024 * 1024 {
                return Err("AI stream event exceeds the size limit".into());
            }
            let event = std::str::from_utf8(&self.bytes[..end])
                .map_err(|_| "AI stream contains invalid UTF-8")?
                .to_string();
            self.bytes.drain(..end + delimiter);
            result.push(event);
        }
        if self.bytes.len() > 4 * 1024 * 1024 {
            return Err("AI stream event exceeds the size limit".into());
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_byte_boundary_preserves_unicode_and_crlf() {
        let input = "data: {\"text\":\"Привет café 👋\"}\r\n\r\n";
        for split in 0..input.len() {
            let mut decoder = Events::default();
            let mut events = decoder.push(&input.as_bytes()[..split]).unwrap();
            events.extend(decoder.push(&input.as_bytes()[split..]).unwrap());
            assert_eq!(events, ["data: {\"text\":\"Привет café 👋\"}"]);
        }
    }
    #[test]
    fn handles_multiple_events_and_refuses_unbounded_partial_data() {
        let mut decoder = Events::default();
        assert_eq!(
            decoder.push(b"data: a\n\ndata: b\n\n").unwrap(),
            ["data: a", "data: b"]
        );
        assert!(decoder.push(&vec![b'x'; 4 * 1024 * 1024 + 1]).is_err());
    }
}
