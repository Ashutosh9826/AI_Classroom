import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { classService, materialService } from '../services/api';
import useAuthStore from '../store/useAuthStore';
import TopNavBar from '../components/TopNavBar';
import Sidebar from '../components/Sidebar';

const formatMaterialSize = (bytes) => {
  const safeBytes = Math.max(0, Number(bytes) || 0);
  if (safeBytes >= 1024 * 1024) {
    return `${(safeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (safeBytes >= 1024) {
    return `${Math.round(safeBytes / 1024)} KB`;
  }
  return `${safeBytes} B`;
};

const formatMaterialDate = (value) => {
  if (!value) return '';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const readFileAsBase64Payload = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      const commaIndex = raw.indexOf(',');
      const base64 = commaIndex >= 0 ? raw.slice(commaIndex + 1) : raw;
      resolve({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64,
      });
    };
    reader.onerror = () => reject(new Error(`Failed to read "${file.name}"`));
    reader.readAsDataURL(file);
  });

export default function ClassMaterialsPage() {
  const { user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const classId = new URLSearchParams(location.search).get('classId');

  const [classInfo, setClassInfo] = useState(null);
  const [materials, setMaterials] = useState([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialsError, setMaterialsError] = useState('');
  const [selectedMaterialFile, setSelectedMaterialFile] = useState(null);
  const [uploadingMaterial, setUploadingMaterial] = useState(false);
  const [materialUploadError, setMaterialUploadError] = useState('');
  const [downloadingMaterialId, setDownloadingMaterialId] = useState(null);
  const materialFileInputRef = useRef(null);

  const isTeacher = user?.role === 'TEACHER';
  const canUploadMaterial = isTeacher && !classInfo?.is_archived;

  const fetchClassMaterials = async (activeClassId) => {
    if (!activeClassId) return;

    try {
      setMaterialsLoading(true);
      setMaterialsError('');
      const result = await materialService.listByClass(activeClassId);
      setMaterials(Array.isArray(result) ? result : []);
    } catch (err) {
      console.error('Failed to load class materials', err);
      setMaterials([]);
      setMaterialsError(err.response?.data?.error || 'Failed to load class materials');
    } finally {
      setMaterialsLoading(false);
    }
  };

  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

  useEffect(() => {
    if (!classId) {
      setClassInfo(null);
      setMaterials([]);
      setMaterialsError('');
      setSelectedMaterialFile(null);
      setMaterialUploadError('');
      return;
    }

    let cancelled = false;

    const hydrateClassInfo = async () => {
      try {
        const details = await classService.getById(classId);
        if (!cancelled) {
          setClassInfo(details);
        }
      } catch (err) {
        console.error('Failed to load class info for materials page', err);
        if (!cancelled) {
          setClassInfo(null);
        }
      }
    };

    hydrateClassInfo();
    fetchClassMaterials(classId);

    return () => {
      cancelled = true;
    };
  }, [classId]);

  const handleMaterialFileSelected = (event) => {
    const nextFile = event.target.files?.[0] || null;
    setSelectedMaterialFile(nextFile);
    setMaterialUploadError('');
  };

  const handleUploadMaterial = async (event) => {
    event.preventDefault();
    if (!classId || !selectedMaterialFile) {
      setMaterialUploadError('Please choose a file to upload.');
      return;
    }

    try {
      setUploadingMaterial(true);
      setMaterialUploadError('');
      const payload = await readFileAsBase64Payload(selectedMaterialFile);
      const created = await materialService.uploadToClass(classId, payload);
      setMaterials((previous) => [created, ...previous.filter((item) => item.id !== created.id)]);
      setSelectedMaterialFile(null);
      if (materialFileInputRef.current) {
        materialFileInputRef.current.value = '';
      }
    } catch (err) {
      console.error('Failed to upload class material', err);
      setMaterialUploadError(err.response?.data?.error || 'Failed to upload material');
    } finally {
      setUploadingMaterial(false);
    }
  };

  const handleDownloadMaterial = async (material) => {
    if (!material?.id) return;
    try {
      setDownloadingMaterialId(material.id);
      setMaterialsError('');
      await materialService.download(material.id, material.file_name);
    } catch (err) {
      console.error('Failed to download class material', err);
      setMaterialsError(err.response?.data?.error || 'Failed to download material');
    } finally {
      setDownloadingMaterialId(null);
    }
  };

  return (
    <div className="bg-background text-on-surface min-h-screen">
      <TopNavBar />
      <div className="flex pt-16">
        <Sidebar />
        <main className="w-full lg:pl-64 px-6 py-8">
          <div className="max-w-5xl mx-auto space-y-6">
            <header>
              <p className="text-xs font-bold uppercase tracking-widest text-outline">Class Material</p>
              <h1 className="text-4xl font-bold tracking-tight mt-2">
                {classInfo?.name || 'Classroom'} Files
              </h1>
              <p className="text-sm text-outline mt-2">Upload and share files for this class.</p>
            </header>

            {!classId && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Open this page from a class so materials are loaded for the selected class.
              </div>
            )}

            {isTeacher && classId && (
              <form onSubmit={handleUploadMaterial} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={materialFileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleMaterialFileSelected}
                  />
                  <button
                    type="button"
                    onClick={() => materialFileInputRef.current?.click()}
                    disabled={!canUploadMaterial || uploadingMaterial}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="material-symbols-outlined text-[18px]">attach_file</span>
                    Choose File
                  </button>
                  {selectedMaterialFile ? (
                    <p className="text-sm text-slate-700">
                      {selectedMaterialFile.name} ({formatMaterialSize(selectedMaterialFile.size)})
                    </p>
                  ) : (
                    <p className="text-sm text-slate-500">Upload PDF, docs, slides, or any study file.</p>
                  )}
                </div>

                {classInfo?.is_archived && (
                  <p className="text-sm text-amber-700">This class is archived. Materials cannot be uploaded.</p>
                )}

                {materialUploadError && (
                  <p className="text-sm text-red-600">{materialUploadError}</p>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={!canUploadMaterial || uploadingMaterial || !selectedMaterialFile}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-primary text-white font-semibold shadow-sm hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="material-symbols-outlined text-[18px]">upload</span>
                    {uploadingMaterial ? 'Uploading...' : 'Upload Material'}
                  </button>
                </div>
              </form>
            )}

            {materialsError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {materialsError}
              </div>
            )}

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">Available Files</h2>
                {classId && (
                  <button
                    type="button"
                    onClick={() => fetchClassMaterials(classId)}
                    disabled={materialsLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[18px]">refresh</span>
                    Refresh
                  </button>
                )}
              </div>

              {materialsLoading ? (
                <p className="text-sm text-slate-500">Loading materials...</p>
              ) : materials.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500">
                  No study materials uploaded yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {materials.map((material) => (
                    <article
                      key={material.id}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-3"
                    >
                      <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
                        <span className="material-symbols-outlined text-[20px]">description</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900 truncate">{material.file_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {formatMaterialSize(material.size_bytes)}
                          {material.uploader?.name ? ` | Uploaded by ${material.uploader.name}` : ''}
                          {material.created_at ? ` | ${formatMaterialDate(material.created_at)}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDownloadMaterial(material)}
                        disabled={downloadingMaterialId === material.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[18px]">download</span>
                        {downloadingMaterialId === material.id ? 'Downloading...' : 'Download'}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
