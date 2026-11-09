import axios from 'axios';

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api';
export const SOCKET_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, '');

const api = axios.create({
  baseURL: API_BASE_URL,
});

const persistUser = (user) => {
  localStorage.setItem('user', JSON.stringify(user));
};

// Request interceptor to add token if it exists
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle unauthorized errors
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear token and redirect to login
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authService = {
  login: async (email, password, role) => {
    const payload = { email, password };
    if (role === 'TEACHER' || role === 'STUDENT') {
      payload.role = role;
    }
    const response = await api.post('/auth/login', payload);
    if (response.data.token) {
      localStorage.setItem('token', response.data.token);
      persistUser(response.data.user);
    }
    return response.data;
  },
  
  register: async (userData) => {
    const response = await api.post('/auth/register', userData);
    if (response.data.token) {
      localStorage.setItem('token', response.data.token);
      persistUser(response.data.user);
    }
    return response.data;
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  getCurrentUser: () => {
    const userStr = localStorage.getItem('user');
    if (userStr) return JSON.parse(userStr);
    return null;
  },

  googleLogin: async (credential, role) => {
    const response = await api.post('/auth/google', { credential, role });
    if (response.data.token) {
      localStorage.setItem('token', response.data.token);
      persistUser(response.data.user);
    }
    return response.data;
  },

  getMe: async () => {
    const response = await api.get('/auth/me');
    persistUser(response.data);
    return response.data;
  },

  updateMe: async (payload) => {
    const response = await api.patch('/auth/me', payload);
    persistUser(response.data);
    return response.data;
  },

  changePassword: async (payload) => {
    const response = await api.patch('/auth/me/password', payload);
    return response.data;
  }
};

export const classService = {
  getClasses: async (options = {}) => {
    const params = {};
    if (options.archived === true) {
      params.archived = 'true';
    } else if (options.archived === false) {
      params.archived = 'false';
    } else if (options.archived === 'all') {
      params.archived = 'all';
    }

    const response = await api.get('/classes', { params });
    return response.data;
  },
  getById: async (classId) => {
    const response = await api.get(`/classes/${classId}`);
    return response.data;
  },
  getStudents: async (classId) => {
    const response = await api.get(`/classes/${classId}/students`);
    return response.data;
  },
  getStudentDetails: async (classId, studentId) => {
    const response = await api.get(`/classes/${classId}/students/${studentId}`);
    return response.data;
  },
  addStudentRecord: async (classId, studentId, payload) => {
    const response = await api.post(`/classes/${classId}/students/${studentId}/records`, payload);
    return response.data;
  },
  deleteStudentRecord: async (classId, studentId, recordId) => {
    const response = await api.delete(`/classes/${classId}/students/${studentId}/records/${recordId}`);
    return response.data;
  },
  removeStudent: async (classId, studentId) => {
    const response = await api.delete(`/classes/${classId}/students/${studentId}`);
    return response.data;
  },
  createClass: async (classData) => {
    const response = await api.post('/classes', classData);
    return response.data;
  },
  joinClass: async (classCode) => {
    const response = await api.post('/classes/join', { class_code: classCode });
    return response.data;
  },
  archiveClass: async (classId) => {
    const response = await api.patch(`/classes/${classId}/archive`);
    return response.data;
  },
  unarchiveClass: async (classId) => {
    const response = await api.patch(`/classes/${classId}/unarchive`);
    return response.data;
  }
};

const parseDownloadFileName = (contentDisposition, fallbackName) => {
  const fallback = String(fallbackName || 'material').trim() || 'material';
  const header = String(contentDisposition || '');
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return fallback;
    }
  }
  const simpleMatch = header.match(/filename="?([^"]+)"?/i);
  if (simpleMatch?.[1]) {
    return simpleMatch[1];
  }
  return fallback;
};

export const materialService = {
  listByClass: async (classId) => {
    const response = await api.get(`/materials/class/${classId}`);
    return response.data;
  },
  uploadToClass: async (classId, payload) => {
    const response = await api.post(`/materials/class/${classId}`, payload);
    return response.data;
  },
  download: async (materialId, fallbackFileName) => {
    const response = await api.get(`/materials/${materialId}/download`, {
      responseType: 'blob',
    });
    const fileName = parseDownloadFileName(
      response.headers?.['content-disposition'],
      fallbackFileName
    );
    const blob = new Blob([response.data], {
      type: response.headers?.['content-type'] || 'application/octet-stream',
    });
    const objectUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(objectUrl);
    return { fileName };
  },
};

export const assignmentService = {
  getByClass: async (classId) => {
    const response = await api.get(`/assignments/class/${classId}`);
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get(`/assignments/${id}`);
    return response.data;
  },
  create: async (assignmentData) => {
    const response = await api.post('/assignments', assignmentData);
    return response.data;
  },
  submit: async (id, fileUrl) => {
    const response = await api.post(`/assignments/${id}/submit`, { file_url: fileUrl });
    return response.data;
  },
  getSubmissions: async (id) => {
    const response = await api.get(`/assignments/${id}/submissions`);
    return response.data;
  },
  grade: async (submissionId, gradeData) => {
    const response = await api.put(`/assignments/submissions/${submissionId}/grade`, gradeData);
    return response.data;
  },
  remove: async (id) => {
    const response = await api.delete(`/assignments/${id}`);
    return response.data;
  }
};

export const announcementService = {
  getByClass: async (classId) => {
    const response = await api.get(`/announcements/class/${classId}`);
    return response.data;
  },
  create: async (classId, payload) => {
    const response = await api.post(`/announcements/class/${classId}`, payload);
    return response.data;
  },
  remove: async (id) => {
    const response = await api.delete(`/announcements/${id}`);
    return response.data;
  },
};

export const lessonService = {
  getByClass: async (classId) => {
    const response = await api.get(`/lessons/class/${classId}`);
    return response.data;
  },
  getPersonalByClass: async (classId) => {
    const response = await api.get(`/lessons/class/${classId}/personal`);
    return response.data;
  },
  getById: async (id) => {
    const response = await api.get(`/lessons/${id}`);
    return response.data;
  },
  forkForStudent: async (lessonId) => {
    const response = await api.post(`/lessons/${lessonId}/fork`);
    return response.data;
  },
  create: async (lessonData) => {
    const response = await api.post('/lessons', lessonData);
    return response.data;
  },
  update: async (id, lessonData) => {
    const response = await api.put(`/lessons/${id}`, lessonData);
    return response.data;
  },
  remove: async (id) => {
    const response = await api.delete(`/lessons/${id}`);
    return response.data;
  },
  generateAi: async (promptData, options = {}) => {
    const response = await api.post('/lessons/generate', promptData, {
      signal: options.signal,
    });
    return response.data;
  },
  refineBlockAi: async (lessonId, payload, options = {}) => {
    const response = await api.post(`/lessons/${lessonId}/refine-block`, payload, {
      signal: options.signal,
    });
    return response.data;
  },
  getPersonalBlocks: async (lessonId) => {
    const response = await api.get(`/lessons/${lessonId}/personal-blocks`);
    return response.data;
  },
  createPersonalBlock: async (lessonId, payload) => {
    const response = await api.post(`/lessons/${lessonId}/personal-blocks`, payload);
    return response.data;
  },
  updatePersonalBlock: async (lessonId, blockId, payload) => {
    const response = await api.put(`/lessons/${lessonId}/personal-blocks/${blockId}`, payload);
    return response.data;
  },
  refinePersonalBlockAi: async (lessonId, blockId, payload, options = {}) => {
    const response = await api.post(`/lessons/${lessonId}/personal-blocks/${blockId}/refine-ai`, payload, {
      signal: options.signal,
    });
    return response.data;
  },
  deletePersonalBlock: async (lessonId, blockId) => {
    const response = await api.delete(`/lessons/${lessonId}/personal-blocks/${blockId}`);
    return response.data;
  },
};

export const codeExecutionService = {
  execute: async (payload) => {
    const response = await api.post('/execute-code', payload);
    return response.data;
  },
};

export const notesService = {
  list: async (lessonId, blockId = null) => {
    const response = await api.get('/notes', {
      params: {
        lessonId,
        ...(blockId ? { blockId } : {}),
      },
    });
    return response.data;
  },
  create: async (payload) => {
    const response = await api.post('/notes', payload);
    return response.data;
  },
  update: async (noteId, payload) => {
    const response = await api.put(`/notes/${noteId}`, payload);
    return response.data;
  },
  remove: async (noteId) => {
    const response = await api.delete(`/notes/${noteId}`);
    return response.data;
  },
};

export const chatService = {
  sendMessageStream: async function* (lessonId, messages, options = {}) {
    const token = localStorage.getItem('token');
    let response;
    try {
      response = await window.fetch(`${API_BASE_URL}/lesson-chat/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ lessonId, messages }),
        signal: options.signal
      });
    } catch (error) {
      const networkError = new Error(error?.message || 'Failed to reach backend API');
      networkError.name = error?.name || 'NetworkError';
      networkError.cause = error;
      networkError.isNetworkError = true;
      throw networkError;
    }

    if (!response.ok) {
      let errorText = 'Failed to get AI response';
      let errObj = null;
      try {
        errObj = await response.json();
        errorText = errObj?.error || errorText;
      } catch {
        errorText = await response.text();
      }

      const apiError = new Error(`API Error: ${errorText}`);
      apiError.status = response.status;
      apiError.response = {
        status: response.status,
        data: errObj || { error: errorText },
      };
      apiError.isApiError = true;
      throw apiError;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); 
      for (const line of lines) {
        if (line.trim()) {
          try {
            yield JSON.parse(line);
          } catch (e) {
            console.error('Failed to parse chunk:', e, line);
          }
        }
      }
    }
    if (buffer.trim()) {
      try { yield JSON.parse(buffer); } catch { /* ignore */ }
    }
  },
  sendMessage: async (lessonId, messages) => {
    const response = await api.post('/lesson-chat/message', { lessonId, messages });
    return response.data;
  },
  evaluateAnswer: async (question, idealAnswer, studentAnswer) => {
    const response = await api.post('/lesson-chat/evaluate-answer', { question, idealAnswer, studentAnswer });
    return response.data;
  }
};

export const attendanceService = {
  getClassDay: async (classId, date) => {
    const response = await api.get(`/attendance/class/${classId}/day`, {
      params: { date },
    });
    return response.data;
  },
  saveManual: async (classId, payload) => {
    const response = await api.post(`/attendance/class/${classId}/day/manual`, payload);
    return response.data;
  },
  takeAutomatic: async (classId, payload) => {
    const response = await api.post(`/attendance/class/${classId}/day/automatic`, payload);
    return response.data;
  },
  getMy: async (classId) => {
    const response = await api.get('/attendance/my', {
      params: { classId },
    });
    return response.data;
  },
};

export default api;
