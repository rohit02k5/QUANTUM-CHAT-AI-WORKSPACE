import React ,{useState} from 'react'
import {Box,Typography,useTheme,useMediaQuery,TextField,Button,Alert,Collapse,FormControlLabel ,Checkbox} from '@mui/material'
import { Link, useNavigate} from 'react-router-dom'
import axios from "axios";
import toast from "react-hot-toast";

const Login = () => {
    const theme =useTheme()
  const Navigate=useNavigate();
  const isNotMobile =useMediaQuery("(min-width:1000px)")
  // const [username,setUsername]=useState("")
  const [email,setEmail]=useState("")
  const [password,setPassword]=useState("")
  const [error,setError]=useState("")
  const [remeberMe,setRemeberMe]=useState(false);
  const handleSubmit =async(e)=>{
    e.preventDefault();
    try {
     const response=await axios.post("/api/v1/auth/login",{email,password});
          const authToken = response.data.token;
          if(remeberMe){
            localStorage.setItem("authToken",authToken);
          }else{
            sessionStorage.setItem("authToken",authToken);
          }
     toast.success("User Logged In Successfully");
     Navigate("/");
      
    } catch (err) {
     console.log(error);
     if (err.response && err.response.status === 401) {
      setError("Invalid email or password");
  } else if (err.response && err.response.data.error) {
      setError(err.response.data.error);
  } else if (err.message) {
      setError(err.message);
  }
setTimeout(()=>{
  setError("");
},5000);
    }
  }

  return (
    <Box width={isNotMobile? '40%':'80%'} p={'2rem'} m={'2rem auto'} borderRadius={5} sx={{boxShadow:5}} backgroundColor={theme.palette.background.alt}>
     <Collapse in={error} >
     <Alert severity="error" sx={{mb:2}}>{error}</Alert>
     </Collapse>
      <form onSubmit={handleSubmit}>
        <Typography variant="h3">Sign In</Typography>
        {/* <TextField label="username" required margin="normal" fullWidth value={username} onChange={(e)=>{
          setUsername(e.target.value);
        }}
        /> */}
        <TextField label="email" type="email" required margin="normal" fullWidth value={email} onChange={(e)=>{
          setEmail(e.target.value);
        }}
        />
        <TextField label="password" type="password" required margin="normal" fullWidth value={password} onChange={(e)=>{
          setPassword(e.target.value);
        }}
        />
        <FormControlLabel
        control={
          <Checkbox checked={remeberMe} onChange={(e)=>setRemeberMe(e.target.checked)}/>
        }label="Remember Me"/>
        <Button type="submit" fullWidth variant="contained" size="large" sx={{color:'white' , mt:2}}>Sign In</Button>
        <Typography>
        Don't have an Account with us?<Link to="/register">Please Register</Link>
        </Typography>
      </form>
    </Box>
  )
}

export default Login
