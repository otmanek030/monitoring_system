from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime

app = FastAPI(title="Phoswatch ML Service", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "ML Service",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/")
async def root():
    return {
        "message": "Phoswatch ML Service is running",
        "endpoints": ["/health", "/predict/anomaly", "/predict/rul"]
    }

@app.post("/predict/anomaly")
async def predict_anomaly(data: dict):
    return {
        "anomaly": False,
        "confidence": 0.95,
        "message": "ML service is working (mock response)"
    }