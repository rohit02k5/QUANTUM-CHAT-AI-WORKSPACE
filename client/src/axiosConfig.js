import axios from "axios";

const baseURL = (process.env.REACT_APP_API_URL || (process.env.NODE_ENV === "production"
  ? "https://quantum-chat-backend.onrender.com"
  : "http://localhost:8080")).trim();

const instance = axios.create({ baseURL, withCredentials: true });
instance.baseURL = baseURL;

const getStorage = () =>
  localStorage.getItem("authToken") ? localStorage : sessionStorage;

const getToken = () =>
  localStorage.getItem("authToken") || sessionStorage.getItem("authToken");

const isValid = (t) => t && t !== "undefined" && t !== "null";

instance.interceptors.request.use((config) => {
  const token = getToken();
  if (isValid(token)) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, try one silent refresh (refresh token stored alongside access token),
// then retry the original request. If refresh fails, the app logs the user out.
let refreshPromise = null;

instance.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status !== 401 || original._retry || original.url.includes("/auth/")) {
      return Promise.reject(error);
    }
    const refreshToken = getStorage().getItem("refreshToken");
    if (!isValid(refreshToken)) return Promise.reject(error);

    original._retry = true;
    try {
      refreshPromise =
        refreshPromise ||
        axios.post(`${baseURL}/api/v1/auth/refresh`, { refreshToken }, { withCredentials: true });
      const { data } = await refreshPromise;
      refreshPromise = null;

      if (!data?.token) return Promise.reject(error);
      const store = getStorage();
      store.setItem("authToken", data.token);
      if (data.refreshToken) store.setItem("refreshToken", data.refreshToken);

      original.headers.Authorization = `Bearer ${data.token}`;
      return instance(original);
    } catch (refreshErr) {
      refreshPromise = null;
      localStorage.removeItem("authToken");
      localStorage.removeItem("refreshToken");
      sessionStorage.removeItem("authToken");
      sessionStorage.removeItem("refreshToken");
      window.location.href = "/login";
      return Promise.reject(refreshErr);
    }
  }
);

export default instance;
