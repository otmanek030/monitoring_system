PROJECT: Real-Time Equipment Monitoring System with AI/ML

CONTEXT:
I'm EL BARNATY Othmane, a 3rd year Bachelor student in Engineering of Computer 
Systems & Software (ISIL) at EST Essaouira. I'm doing my PFE (final year project) 
internship at OCP Group - Mining Division, Benguerir (phosphate processing plant) 
from April 15 to July 15, 2026. My intensive development phase is April 15 - May 15, 
2026 (5 weeks). My supervisor is FAHMI Abderrahim.

PROJECT GOAL:
Develop a comprehensive real-time monitoring system for critical equipment at the 
phosphate washing and flotation plant, integrating AI-powered prediction and 
simulation capabilities.

SYSTEM FEATURES:
1. Real-time data collection from industrial equipment via SCADA/OPC UA/Modbus
2. Live interactive dashboard with charts, gauges, and equipment status
3. Automated alerts when thresholds are exceeded or faults are detected
4. AI-powered anomaly detection (Isolation Forest)
5. Predictive maintenance model (XGBoost - predicts failures 7-14 days ahead)
6. RUL (Remaining Useful Life) prediction using LSTM neural networks
7. Historical data visualization and trend analysis
8. Excel/PDF export of reports with AI insights
9. Multi-user support with role-based access (admin, technician, supervisor)

ARCHITECTURE:
Docker microservices architecture with 4 services:
- Backend (Node.js + Express): REST API + WebSocket, port 3000
- ML Service (Python + FastAPI): AI models, port 8000
- Frontend (React + Recharts): Dashboard UI, port 80
- Database (PostgreSQL + TimescaleDB): Time-series data, port 5432

All orchestrated with docker-compose.yml for easy deployment.

TECH STACK:
- Backend: Node.js, Express, Socket.io, JWT, PostgreSQL client
- ML: Python, FastAPI, scikit-learn, XGBoost, TensorFlow, Pandas
- Frontend: React 18, Recharts, Axios, Socket.io-client
- Database: PostgreSQL 15 + TimescaleDB extension
- Industrial Integration: OPC UA, Modbus (node-opcua, pymodbus)
- Deployment: Docker + Docker Compose
- Testing: Jest, Pytest, React Testing Library

FOLDER STRUCTURE:
your-project-folder/
├── docker-compose.yml
├── backend/ (Node.js API with routes, controllers, services, middleware)
├── ml-service/ (Python FastAPI with anomaly detection, predictive maintenance, RUL models)
├── frontend/ (React with Dashboard, ML displays, Reports components)
└── database/ (init.sql for PostgreSQL schema)

COMMUNICATION RULES:
- Inside Docker, use SERVICE NAMES not localhost
- Backend calls ML: http://ml-service:8000
- Backend calls Database: postgresql://user:pass@database:5432
- Frontend calls Backend: through Nginx proxy

5-WEEK TIMELINE:
- Week 1 (Apr 15-21): Foundation, architecture, Docker setup
- Week 2 (Apr 22-28): Backend API + Anomaly detection v1
- Week 3 (Apr 29-May 5): Data collection + SCADA + Anomaly v2 + RUL start
- Week 4 (May 6-12): Frontend dashboard + Predictive maintenance
- Week 5 (May 13-15): Integration, testing, AI optimization

DELIVERABLES BY MAY 15:
- Production-ready monitoring system
- 20+ REST API endpoints
- 3 AI models deployed (anomaly, predictive, RUL)
- Real-time dashboard with <500ms latency
- SCADA integration
- Excel/PDF export
- >70% test coverage
- Complete documentation
- Docker deployment ready

HOW TO HELP ME:
- Provide code examples with clear comments
- Focus on production-ready solutions
- Prefer microservices best practices
- Include error handling and logging
- Consider real-time performance (<500ms)
- Follow my folder structure (backend/src/routes, controllers, services, etc.)
- Use my tech stack (Node.js backend, Python ML, React frontend)
- Assume Docker environment (use service names, not localhost)
- Explain concepts clearly (I'm a student learning)
- Provide testing examples when relevant
- Suggest improvements to my code

COMMUNICATION PREFERENCE:
- Clear, step-by-step explanations
- Code comments in English
- Brief theory + lots of practical examples
- Point out common mistakes
- Recommend best practices for industrial monitoring systems