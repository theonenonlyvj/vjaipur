import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { socketService } from './socket/socketService'

// Start connecting immediately to wake up the server (Render cold starts)
const url = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'
socketService.connect(url)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
