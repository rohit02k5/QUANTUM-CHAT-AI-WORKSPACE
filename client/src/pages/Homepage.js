import React, { useContext } from 'react';
import { Box, Typography, Card, Stack, IconButton, useTheme } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { ColorModeContext } from "../context/ThemeContext"; // Add this import
import Brightness4Icon from "@mui/icons-material/Brightness4"; // Add this import
import Brightness7Icon from "@mui/icons-material/Brightness7"; // Add this import
import DescriptionRounded from '@mui/icons-material/DescriptionRounded';
import ChatRounded from '@mui/icons-material/ChatRounded';
const Homepage = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const colorMode = useContext(ColorModeContext);

  return (
    <Box sx={{ display: "flex", flexDirection: "row", flexWrap: 'wrap' }}> 
      <Box p={2}>
        <Typography variant="h5" mb={1} fontWeight="bold"> 
          Image Generation
        </Typography>
        <Card
          onClick={() => window.open("https://neurapix-frontend-3.onrender.com/", "_blank")}
          sx={{
            boxShadow: 2,
            borderRadius: 5,
            height: 180,
            width: 180, 
            "&:hover": {
              border: 2,
              boxShadow: 0,
              borderColor: "primary.dark",
              cursor: "pointer",
            },
          }}
        >
          <DescriptionRounded
            sx={{ fontSize: 70, color: "primary.main", mt: 2, ml: 2 }}
          />
          <Stack p={2} pt={0}> 
            <Typography fontWeight="bold" variant="h6"> 
              Image Generation
            </Typography>
            <Typography variant="body2"> 
              Generate Images through your creative prompts!
            </Typography>
          </Stack>
        </Card>
      </Box>

      <Box p={2}>
        <Typography variant="h5" mb={1} fontWeight="bold"> 
          AI Chatbot
        </Typography>
        <Card
          onClick={() => navigate("/chatbot")}
          sx={{
            boxShadow: 2,
            borderRadius: 5,
            height: 180, 
            width: 180, 
            "&:hover": {
              border: 2,
              boxShadow: 0,
              borderColor: "primary.dark",
              cursor: "pointer",
            },
          }}
        >
          <ChatRounded
            sx={{ fontSize: 70, color: "primary.main", mt: 2, ml: 2 }} 
          />
          <Stack p={2} pt={0}> 
            <Typography fontWeight="bold" variant="h6"> 
              Chatbot
            </Typography>
            <Typography variant="body2"> 
              Chat With AI Chatbot
            </Typography>
          </Stack>
        </Card>
      </Box>

      <Box p={2}>
        <Typography variant="h5" mb={1} fontWeight="bold"> 
          SEO Recommender
        </Typography>
        <Card
          onClick={() => navigate("/datavisualizer")}
          sx={{
            boxShadow: 2,
            borderRadius: 5,
            height: 180, 
            width: 180, 
            "&:hover": {
              border: 2,
              boxShadow: 0,
              borderColor: "primary.dark",
              cursor: "pointer",
            },
          }}
        >
          <ChatRounded
            sx={{ fontSize: 70, color: "primary.main", mt: 2, ml: 2 }} 
          />
          <Stack p={2} pt={0}> 
            <Typography fontWeight="bold" variant="h6"> 
              Text Visualization
            </Typography>
            <Typography variant="body2"> 
              Visualize text for SEO!
            </Typography>
          </Stack>
        </Card>
      </Box>

      <Box p={2}>
        <Typography variant="h5" mb={1} fontWeight="bold">
          Text Generation
        </Typography>
        <Card
          onClick={() => navigate("/summary")}
          sx={{
            boxShadow: 2,
            borderRadius: 5,
            height: 180, 
            width: 180,
            "&:hover": {
              border: 2,
              boxShadow: 0,
              borderColor: "primary.dark",
              cursor: "pointer",
            },
          }}
        >
          <DescriptionRounded
            sx={{ fontSize: 70, color: "primary.main", mt: 2, ml: 2 }} 
          />
          <Stack p={2} pt={0}> 
            <Typography fontWeight="bold" variant="h6"> 
              TEXT SUMMARY
            </Typography>
            <Typography variant="body2"> 
              Summarize long text into short sentences
            </Typography>
          </Stack>
        </Card>
      </Box>

      <IconButton onClick={colorMode.toggleColorMode} sx={{ position: 'absolute', top: 16, right: 16 }}>
        {theme.palette.mode === "dark" ? (
          <Brightness7Icon />
        ) : (
          <Brightness4Icon />
        )}
      </IconButton>
    </Box>
  );
}

export default Homepage;
