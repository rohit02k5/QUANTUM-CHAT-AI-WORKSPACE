import axios from "axios";

const instance = axios.create({
  baseURL: process.env.NODE_ENV === "production" 
    ? "http://localhost:8080" 
    : "http://localhost:8080", // Default to localhost for both environments
});

export default instance;