# Local Model Setup with llama.cpp

## Quick Start

### 1. Download & Install llama.cpp

**Windows (PowerShell):**
```powershell
# Create directory
mkdir C:\llama.cpp
cd C:\llama.cpp

# Download latest release (choose CPU or GPU version)
# GPU (CUDA): https://github.com/ggerganov/llama.cpp/releases/download/b3270/llama-3270-bin-win-cuda-cu12.1.0.zip
# CPU: https://github.com/ggerganov/llama.cpp/releases/download/b3270/llama-3270-bin-win-x64.zip

# Extract to C:\llama.cpp\
```

### 2. Download Model

Download **Mistral 7B Q4_K_M** (~4.4GB):

```powershell
cd C:\llama.cpp
mkdir models
cd models

# Using curl
curl -L -o Mistral-7B-Instruct-v0.2.Q4_K_M.gguf `
  "https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/Mistral-7B-Instruct-v0.2.Q4_K_M.gguf"

# Verify download (should be ~4.4GB)
ls -lh Mistral-7B-Instruct-v0.2.Q4_K_M.gguf
```

### 3. Start llama.cpp Server

**Terminal 1: Start llama.cpp**
```powershell
cd C:\llama.cpp

# CPU only (slower)
.\server.exe -m .\models\Mistral-7B-Instruct-v0.2.Q4_K_M.gguf -c 2048 --port 8000

# GPU (CUDA) - recommended for speed
.\server.exe -m .\models\Mistral-7B-Instruct-v0.2.Q4_K_M.gguf -c 2048 --port 8000 -ngl 32

# If using cuBLAS (NVIDIA GPU), may need:
# .\server.exe -m .\models\Mistral-7B-Instruct-v0.2.Q4_K_M.gguf -c 2048 --port 8000 --gpu-layers 32
```

**Expected output:**
```
server is listening on http://0.0.0.0:8000
accepting incoming connections
```

### 4. Start Plexus Backend

**Terminal 2:**
```powershell
cd C:\Project\plexus2\backend

# Activate venv
.\.venv\Scripts\Activate.ps1

# Run backend (will use local model automatically)
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

**Expected log output:**
```
✓ Local LLM client initialized: http://127.0.0.1:8000
```

### 5. Test in Frontend

1. Open frontend: http://localhost:3000
2. Upload a contract
3. Backend will use local Mistral model automatically

## Configuration

Current `.env` settings:
```
LLM_BACKEND=local
LOCAL_LLM_URL=http://127.0.0.1:8000
LOCAL_LLM_MODEL=mistral
```

### Switch Back to Groq

To use Groq API instead:
```
LLM_BACKEND=groq
GROQ_API_KEY=your_key_here
```

## Performance Notes

- **Speed**: 2-3 tokens/sec on GPU, slower on CPU
- **Quality**: Good (7B model) - not as good as Groq's 70B, but serviceable
- **Extraction time**: ~3-5 minutes for a 404-block contract
- **Memory**: ~4GB VRAM (with quantization), + 4-8GB RAM for context

## Troubleshooting

### Server won't start
- Ensure port 8000 is free: `netstat -ano | findstr :8000`
- Try different port: `--port 8001`

### Backend can't connect
- Check llama.cpp server is running: `curl http://127.0.0.1:8000/health`
- Verify LOCAL_LLM_URL in `.env`

### Extraction is slow or timing out
- Reduce max_tokens in extraction (already done for local models)
- Ensure llama.cpp has GPU acceleration enabled
- Try CPU with `-c 512` (smaller context) for testing

### Out of memory
- Reduce context: `-c 1024` in llama.cpp
- Use smaller model: `llama-2-7b` or `neural-chat`
