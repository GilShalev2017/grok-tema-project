// src/api/api.ts
import axios from 'axios';

const api = axios.create({
  baseURL: '/api', // thanks to Vite proxy
  timeout: 15000,
});

export const importMet = (searchTerm: string = "*", departmentIds: string[] = []) =>
  api.post('/import/met', { searchTerm, departmentIds });

export const getItems = () => api.get('/items');

export const enrichItem = (id: string) => api.post(`/enrich/${id}`);