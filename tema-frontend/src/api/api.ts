// src/api/api.ts
import axios from 'axios';

const api = axios.create({
  baseURL: '/api', // thanks to Vite proxy
  timeout: 15000,
});

export const importMet = (searchTerm: string = "*", departmentIds: string[] = []) =>
  api.post('/import/met', { searchTerm, departmentIds });

export const getItems = (page: number = 1, limit: number = 100) => 
  api.get('/items', { params: { page, limit } });

export const enrichItem = (id: string) => api.post(`/enrich/${id}`);