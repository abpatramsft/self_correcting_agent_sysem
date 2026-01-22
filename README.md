# Self-Correcting Agents Web UI

A web application to visualize multi-agent workflow streaming from Azure AI Projects.

## Project Structure

```
├── backend/
│   ├── main.py           # FastAPI app with SSE streaming
│   ├── azure_client.py   # Azure AI Projects client
│   └── requirements.txt  # Python dependencies
├── frontend/
│   ├── src/
│   │   ├── App.jsx       # React main component
│   │   ├── App.css       # Styling
│   │   └── main.jsx      # Entry point
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
└── script.py             # Original CLI script
```

## Setup

### Backend

```bash
cd backend

# Create virtual environment (optional)
python -m venv venv
venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt

# Run the server
python main.py
```

Backend runs at http://localhost:8000

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Run dev server
npm run dev
```

Frontend runs at http://localhost:5173

## Usage

1. Start the backend server
2. Start the frontend dev server
3. Open http://localhost:5173 in your browser
4. Enter a query and click "Send"
5. Watch the workflow events stream in the left panel and the response in the right panel

## Authentication

Uses `DefaultAzureCredential` which supports:
- Azure CLI login (`az login`)
- Environment variables
- Managed Identity (in Azure)

Make sure you're logged in with `az login` before running.
