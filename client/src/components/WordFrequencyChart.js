import React from "react";
import Plot from "react-plotly.js";

const WordFrequencyChart = ({ wordFrequency }) => {
  const data = [
    {
      x:wordFrequency.map((item) => item.word),
      y: wordFrequency.map((item) => item.count),
      type: "bar",
      marker: {
        color: "rgba(75, 192, 192, 0.6)",
      },
    },
  ];
   
  const layout = {
    title: "Word Frequency",
    xaxis: { title: "Words" },
    yaxis: { title: "Frequency" },
  };
 
return <Plot data={data} layout={layout}/>;
};

export default WordFrequencyChart;
