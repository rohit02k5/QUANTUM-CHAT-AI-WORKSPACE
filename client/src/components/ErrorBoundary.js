import React from "react";
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  // Update the state when an error is caught
  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  // Optionally log the error details
  componentDidCatch(error, errorInfo) {
    console.error("Error caught by ErrorBoundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Render fallback UI when an error is caught
      return (
        <div style={{ color: "red", textAlign: "center", marginTop: "20px" }}>
          <h2>Something went wrong.</h2>
          <p>Please try again later or contact support.</p>
        </div>
      );
    }

    // Render children if no error occurred
    return this.props.children;
  }
}

export default ErrorBoundary;
