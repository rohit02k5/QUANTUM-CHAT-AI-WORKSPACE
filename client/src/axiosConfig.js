import axios from "axios";

const instance = axios.create({
  /* 
     Fixes: 
     1. Trims baseURL to remove accidental spaces in env vars 
     2. Handles both production and local envs 
  */
  baseURL: (process.env.REACT_APP_API_URL || (process.env.NODE_ENV === "production"
    ? "https://quantum-chat-backend.onrender.com"
    : "http://localhost:8080")).trim(),
});

instance.interceptors.request.use((config) => {
  const token = localStorage.getItem("authToken") || sessionStorage.getItem("authToken");

  // CRITICAL FIX: Only attach token if it is valid strings
  // Prevents sending "Bearer undefined" literal string
  if (token && token !== "undefined" && token !== "null") {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default instance;