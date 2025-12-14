import React from "react";
import { Navigate } from "react-router-dom";
import toast from "react-hot-toast";

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem("authToken") || sessionStorage.getItem("authToken");
  const loggedIn = token && token !== "undefined" && token !== "null";

  if (!loggedIn) {
    // If token is invalid/bad, clear it just in case
    localStorage.removeItem("authToken");
    sessionStorage.removeItem("authToken");
    toast.error("Session expired or invalid. Please login again.");
    return <Navigate to="/login" replace />;
  }
  return children
};

export default ProtectedRoute
