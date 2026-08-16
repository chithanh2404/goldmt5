import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:10000';

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
});

api.interceptors.request.use(cfg=>{
  const token = localStorage.getItem('investor_token');
  if(token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Helper wrappers matching old callApi style
export async function callApi(path, payload={}){
  try{
    const res = await api.post(path, payload);
    return res.data;
  }catch(e){
    return { error: e.response?.data?.error || e.message };
  }
}

export async function getProfits(){
  try{
    const res = await api.get('/profits');
    return Array.isArray(res.data) ? res.data : [];
  }catch(e){ return []; }
}
