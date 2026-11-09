const express = require('express');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireTeacher } = require('../middleware/authMiddleware');

const router = express.Router();
const prisma = new PrismaClient();

const MAX_FILE_BYTES = Number(process.env.MATERIAL_MAX_FILE_BYTES || 15 * 1024 * 1024);
const MAX_FILE_NAME_LENGTH = 180;

const normalizeId = (value) => String(value || '').trim();

const sanitizeFileName = (rawFileName) => {
  const normalized = String(rawFileName || '')
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ');
  const bounded = normalized.slice(0, MAX_FILE_NAME_LENGTH).replace(/^\.+/, '');
  return bounded || 'material';
};

const decodeBase64Payload = (rawBase64) => {
  const trimmed = String(rawBase64 || '').trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.includes(',') ? trimmed.split(',').pop() : trimmed;
  const buffer = Buffer.from(normalized || '', 'base64');
  if (!buffer || buffer.length === 0) {
    return null;
  }
  return buffer;
};

const verifyClassAccess = async ({ classId, userId, role }) => {
  const safeClassId = normalizeId(classId);
  if (!safeClassId) {
    return { status: 400, error: 'Invalid class id' };
  }

  const classRecord = await prisma.class.findUnique({
    where: { id: safeClassId },
    select: { id: true, name: true, teacher_id: true, is_archived: true },
  });

  if (!classRecord) {
    return { status: 404, error: 'Class not found' };
  }

  if (role === 'TEACHER') {
    if (classRecord.teacher_id !== userId) {
      return { status: 403, error: 'Access denied' };
    }
    return { classRecord };
  }

  const enrollment = await prisma.enrollment.findFirst({
    where: {
      class_id: safeClassId,
      user_id: userId,
    },
    select: { id: true },
  });

  if (!enrollment) {
    return { status: 403, error: 'Access denied' };
  }

  return { classRecord };
};

const toMaterialResponse = (material) => ({
  id: material.id,
  class_id: material.class_id,
  uploader_id: material.uploader_id,
  file_name: material.file_name,
  mime_type: material.mime_type,
  size_bytes: material.size_bytes,
  created_at: material.created_at,
  uploader: material.uploader
    ? {
        id: material.uploader.id,
        name: material.uploader.name,
      }
    : null,
  download_path: `/api/materials/${material.id}/download`,
});

router.get('/class/:classId', authenticateToken, async (req, res) => {
  try {
    const classId = normalizeId(req.params.classId);
    const access = await verifyClassAccess({
      classId,
      userId: req.user.userId,
      role: req.user.role,
    });

    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }

    const materials = await prisma.classMaterial.findMany({
      where: { class_id: classId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        class_id: true,
        uploader_id: true,
        file_name: true,
        mime_type: true,
        size_bytes: true,
        created_at: true,
        uploader: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return res.json(materials.map(toMaterialResponse));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to load class materials' });
  }
});

router.post('/class/:classId', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const classId = normalizeId(req.params.classId);
    const access = await verifyClassAccess({
      classId,
      userId: req.user.userId,
      role: req.user.role,
    });

    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }
    if (access.classRecord?.is_archived) {
      return res.status(400).json({ error: 'Cannot upload material to an archived class' });
    }

    const { fileName, mimeType, base64 } = req.body || {};
    const safeFileName = sanitizeFileName(fileName);
    const safeMimeType =
      typeof mimeType === 'string' && mimeType.trim()
        ? mimeType.trim().slice(0, 120)
        : 'application/octet-stream';

    const payloadBuffer = decodeBase64Payload(base64);
    if (!payloadBuffer) {
      return res.status(400).json({ error: 'Invalid file payload' });
    }
    if (payloadBuffer.length > MAX_FILE_BYTES) {
      return res
        .status(413)
        .json({ error: `Material exceeds size limit of ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB` });
    }

    const created = await prisma.classMaterial.create({
      data: {
        id: crypto.randomUUID(),
        class_id: classId,
        uploader_id: req.user.userId,
        file_name: safeFileName,
        mime_type: safeMimeType,
        size_bytes: payloadBuffer.length,
        file_blob: payloadBuffer,
      },
      select: {
        id: true,
        class_id: true,
        uploader_id: true,
        file_name: true,
        mime_type: true,
        size_bytes: true,
        created_at: true,
        uploader: {
          select: { id: true, name: true },
        },
      },
    });

    return res.status(201).json(toMaterialResponse(created));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to upload class material' });
  }
});

router.get('/:materialId/download', authenticateToken, async (req, res) => {
  try {
    const materialId = normalizeId(req.params.materialId);
    if (!materialId) {
      return res.status(400).json({ error: 'Invalid material id' });
    }

    const material = await prisma.classMaterial.findUnique({
      where: { id: materialId },
      select: {
        id: true,
        class_id: true,
        file_name: true,
        mime_type: true,
        size_bytes: true,
        file_blob: true,
      },
    });

    if (!material) {
      return res.status(404).json({ error: 'Material not found' });
    }

    const access = await verifyClassAccess({
      classId: material.class_id,
      userId: req.user.userId,
      role: req.user.role,
    });
    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }

    const encodedName = encodeURIComponent(material.file_name).replace(/['()]/g, (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`
    );
    const fileBuffer = Buffer.from(material.file_blob);

    res.setHeader('Content-Type', material.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', String(material.size_bytes || fileBuffer.length));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);

    return res.status(200).send(fileBuffer);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to download class material' });
  }
});

module.exports = router;
