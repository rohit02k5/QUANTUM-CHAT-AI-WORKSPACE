import React from "react";
import Plot from "react-plotly.js";

const SentimentChart = ({ sentiment }) => {
  // Ensure valid sentiment data
  if (
    !sentiment ||
    typeof sentiment !== "object" ||
    !sentiment.positive ||
    !sentiment.negative ||
    !sentiment.neutral
  ) {
    return <div>No sentiment data available.</div>;
  }

  // Calculate counts for sentiments
  const positiveCount = sentiment.positive.length || 0;
  const negativeCount = sentiment.negative.length || 0;
  const neutralCount = sentiment.neutral.length || 0;

  console.log("Sentiment data:", sentiment);

  // Prepare data for Plotly
  const data = [
    {
      values: [positiveCount, negativeCount, neutralCount],
      labels: ["Positive", "Negative", "Neutral"],
      type: "pie",
      marker: {
        colors: ["#4CAF50", "#F44336", "#FFC107"], // Green, Red, Yellow
      },
    },
  ];

  // Layout configuration
  const layout = {
    title: "Sentiment Analysis",
    height: 400,
    width: 500,
    showlegend: true,
  };

  return (
    <div>
      <Plot data={data} layout={layout} />
    </div>
  );
};

export default SentimentChart;
