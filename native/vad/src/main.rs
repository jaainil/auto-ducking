use ort::{session::Session, value::Tensor};
use std::{env, io::{self, Read, Write}};

const WINDOW: usize = 512;
const CONTEXT: usize = 64;

fn main() {
    if let Err(error) = detect() {
        eprintln!("audioduck-vad: {error}");
        std::process::exit(1);
    }
}

fn detect() -> Result<(), Box<dyn std::error::Error>> {
    let model = env::args().nth(1).ok_or("expected model path")?;
    let mut bytes = Vec::new();
    // Match the server's decode limit; never accept an unbounded input stream.
    io::stdin().take(480 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > 480 * 1024 * 1024 || bytes.len() % 4 != 0 {
        return Err("invalid float32 PCM input".into());
    }
    let samples: Vec<f32> = bytes.chunks_exact(4)
        .map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect();
    if samples.iter().any(|x| !x.is_finite()) {
        return Err("PCM samples must be finite".into());
    }
    // Small recurrent frames perform better without a thread pool per operation.
    let mut session = Session::builder()?.with_intra_threads(1)?.commit_from_file(model)?;
    let sr = Tensor::from_array(([1], vec![16000_i64]))?;
    let mut state = vec![0_f32; 256];
    let mut context = [0_f32; CONTEXT];
    let mut output = io::BufWriter::new(io::stdout().lock());
    for frame in samples.chunks(WINDOW) {
        let mut data = vec![0_f32; CONTEXT + WINDOW];
        data[..CONTEXT].copy_from_slice(&context);
        data[CONTEXT..CONTEXT + frame.len()].copy_from_slice(frame);
        context.copy_from_slice(&data[WINDOW..]);
        let outputs = session.run(ort::inputs![
            "input" => Tensor::from_array(([1, CONTEXT + WINDOW], data))?,
            "state" => Tensor::from_array(([2, 1, 128], state))?,
            "sr" => &sr
        ])?;
        state = outputs["stateN"].try_extract_tensor::<f32>()?.1.to_vec();
        let p = outputs["output"].try_extract_tensor::<f32>()?.1[0];
        output.write_all(&if p.is_finite() { p } else { 0.0 }.to_le_bytes())?;
    }
    output.flush()?;
    Ok(())
}
