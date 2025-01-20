// src/utils/textProcessing.js
// Word Frequency Counter
  // Sentiment Analysis
import Sentiment from 'sentiment';
export function generateWordFrequency(text) {
  if (typeof text !== "string") {
    throw new Error("Input must be a string");
  }
    const words = text.toLowerCase().split(/\W+/);
    const frequency = {};
    words.forEach((word) => {
      frequency[word] = (frequency[word] || 0) + 1;
    });
    return Object.entries(frequency).map(([word, count]) => ({ word, count }));
  }
  export function analyzeSentiment(text) {
    if (!text) return { positive: 0, negative: 0, neutral: 0 };
    const sentiment = new Sentiment();
    const result = sentiment.analyze(text);
    const positiveWords=result.positive||[];
    const negativeWords = result.negative || [];
    const allWords = text.toLowerCase().split(/\W+/);
    const neutralWords = allWords.filter(
      (word) =>
        word.length > 0 && !positiveWords.includes(word) && !negativeWords.includes(word)
    );
  
    return {
      positive: positiveWords,
      negative: negativeWords,
      neutral: neutralWords,
    };
  }
  export const generateKeyTakeawaysForWordFrequency = (wordFrequency) => {
    const sortedWords = wordFrequency.sort((a, b) => b.count - a.count);
    const topWords = sortedWords.slice(0, 5).map(item => item.word);
  
    return {
      mostFrequentWords: topWords,
      insights: `The most frequent words are ${topWords.join(", ")}, indicating a focus on these topics.`,
    };
  };
  
  export const generateKeyTakeawaysForSentiment = (sentiment) => {
    const totalSentences = sentiment.positive.length + sentiment.negative.length + sentiment.neutral.length;
    const positivePercentage = ((sentiment.positive.length / totalSentences) * 100).toFixed(1);
    const negativePercentage = ((sentiment.negative.length / totalSentences) * 100).toFixed(1);
    const neutralPercentage = ((sentiment.neutral.length / totalSentences) * 100).toFixed(1);
  
    const insights = `Your text has a ${neutralPercentage}% neutral tone, ${positivePercentage}% positivity, and ${negativePercentage}% negativity.`;
  
    const actionPoints = [];
    if (neutralPercentage > 80) {
      actionPoints.push("Consider adding more descriptive or emotional language to make the text more engaging.");
    }
    if (negativePercentage > 10) {
      actionPoints.push("Revise negative phrases to make them more constructive or positive.");
    }
  
    return { insights, actionPoints };
  };
  
  
  