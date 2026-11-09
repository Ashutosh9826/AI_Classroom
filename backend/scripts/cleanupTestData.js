const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanupTestData() {
  console.log('Starting Test Data Cleanup...');
  const keywords = ['test', 'demo', 'placeholder'];

  const buildContainsQueries = (fields) => {
    return fields.flatMap((field) =>
      keywords.map((keyword) => ({
        [field]: { contains: keyword, mode: 'insensitive' },
      }))
    );
  };

  try {
    // 1. Find target Classes
    const targetClasses = await prisma.class.findMany({
      where: {
        OR: buildContainsQueries(['name', 'section']),
      },
      select: { id: true },
    });
    const classIds = targetClasses.map((c) => c.id);

    // 2. Find target Assignments
    const targetAssignments = await prisma.assignment.findMany({
      where: {
        OR: [
          ...buildContainsQueries(['title', 'description']),
          { class_id: { in: classIds } },
        ],
      },
      select: { id: true },
    });
    const assignmentIds = targetAssignments.map((a) => a.id);

    // 3. Find target Users
    const targetUsers = await prisma.user.findMany({
      where: {
        OR: buildContainsQueries(['name', 'email']),
      },
      select: { id: true },
    });
    const userIds = targetUsers.map((u) => u.id);

    console.log(
      `Found ${userIds.length} users, ${classIds.length} classes, and ${assignmentIds.length} assignments to delete.`
    );

    // Perform transaction to safely delete
    await prisma.$transaction([
      prisma.submission.deleteMany({
        where: {
          OR: [{ assignment_id: { in: assignmentIds } }, { student_id: { in: userIds } }],
        },
      }),
      prisma.attendanceRecord.deleteMany({
        where: {
          OR: [{ class_id: { in: classIds } }, { student_id: { in: userIds } }],
        },
      }),
      prisma.enrollment.deleteMany({
        where: {
          OR: [{ class_id: { in: classIds } }, { user_id: { in: userIds } }],
        },
      }),
      prisma.assignment.deleteMany({
        where: { id: { in: assignmentIds } },
      }),
      // We will perform a simple class / user deletion assuming Prisma Schema has Cascade rules, 
      // or the related data was explicitly isolated to test users/classes.
      prisma.class.deleteMany({
        where: { id: { in: classIds } },
      }),
      prisma.user.deleteMany({
        where: { id: { in: userIds } },
      }),
    ]);

    console.log('Test data cleanup completed successfully.');
  } catch (error) {
    console.error('Error cleaning up test data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanupTestData();
