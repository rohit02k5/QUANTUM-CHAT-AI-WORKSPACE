import React from 'react'
import { Navigate } from "react-router-dom";
import toast from "react-hot-toast";

const ProtectedRoute = ({children}) => {
  const loggedIn = !!localStorage.getItem("authToken");
  if(!loggedIn){
    toast.error("You need to Login/Register first!");
    return <Navigate to="/login" replace/>;
  }
  return children
};

export default ProtectedRoute
