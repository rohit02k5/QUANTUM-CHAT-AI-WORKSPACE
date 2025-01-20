import React, { useState ,useContext} from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { ColorModeContext } from "../context/ThemeContext"; // Add this import
import Brightness4Icon from "@mui/icons-material/Brightness4"; // Add this import
import Brightness7Icon from "@mui/icons-material/Brightness7"; 
import axios from "../axiosConfig";

import {
  Box,
  Typography,
  useTheme,
  useMediaQuery,
  TextField,
  Button,
  Alert,
  Collapse,
  Card,
  IconButton ,
} from "@mui/material";

const Summary = () => {
   const colorMode = useContext(ColorModeContext);
  const theme = useTheme();
  const navigate = useNavigate();
  const isNotMobile = useMediaQuery("(min-width: 1000px)");

  const [text, settext] = useState("");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const { data } = await axios.post("/api/v1/openai/summary", { text });
      console.log(data);
      setSummary(data.summary); // Use "data.summary" based on your backend response
 // Store the specific property
    } catch (err) {
      console.log(err);
      if (err.response?.data?.error) {
        setError(err.response.data.error);
      } else if (err.message) {
        setError(err.message);
      }
      setTimeout(() => {
        setError("");
      }, 5000);
    }
  };

  return (
    <Box
      width={isNotMobile ? "40%" : "80%"}
      p={"2rem"}
      m={"2rem auto"}
      borderRadius={5}
      sx={{ boxShadow: 5 }}
      backgroundColor={theme.palette.background.alt}
    >
      <Collapse in={error}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      </Collapse>
      <form onSubmit={handleSubmit}>
        <Typography variant="h3">Summarize Text</Typography>
        <TextField
          placeholder="Add your text"
          type="text"
          multiline={true}
          required
          margin="normal"
          fullWidth
          value={text}
          onChange={(e) => {
            settext(e.target.value);
          }}
        />
        <Button
          type="submit"
          fullWidth
          variant="contained"
          size="large"
          sx={{ color: "white", mt: 2 }}
        >
          Submit
        </Button>
        <Typography mt={2}>
          Not this tool? <Link to="/">Go Back</Link>
        </Typography>
      </form>
      {summary ? (
        <Card
          sx={{
            mt: 4,
            border: 1,
            boxShadow: 0,
            height: "500px",
            borderRadius: 5,
            borderColor: "natural.medium",
            bgcolor: "background.default",
          }}
        >
          <Typography p={2}>
            {typeof summary === "string" ? summary : JSON.stringify(summary)}
          </Typography>
        </Card>
      ) : (
        <Card
          sx={{
            mt: 4,
            border: 1,
            boxShadow: 0,
            height: "500px",
            borderRadius: 5,
            borderColor: "natural.medium",
            bgcolor: "background.default",
          }}
        >
          <Typography
            variant="h5"
            color="natural.main"
            sx={{
              textAlign: "center",
              verticalAlign: "middle",
              lineHeight: "450px",
            }}
          >
            Summary Will Appear Here
          </Typography>
        </Card>
      )}
      <IconButton onClick={colorMode.toggleColorMode} sx={{position:'absolute',top:16,right:16}}>
        {theme.palette.mode ==="dark"?(<Brightness7Icon/>):(<Brightness4Icon/>)}
      </IconButton>
    </Box>
  );
};

export default Summary;
