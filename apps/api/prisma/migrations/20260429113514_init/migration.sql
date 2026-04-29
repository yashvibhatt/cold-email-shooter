-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SCHEDULED', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "microsoftId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiry" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploaded_files" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploaded_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "scheduledDatetime" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "sourceFileId" TEXT,
    "sentAt" TIMESTAMP(3),
    "failedReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_send_logs" (
    "id" TEXT NOT NULL,
    "emailJobId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_send_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_microsoftId_key" ON "users"("microsoftId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "email_jobs_idempotencyKey_key" ON "email_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "email_jobs_userId_status_idx" ON "email_jobs"("userId", "status");

-- CreateIndex
CREATE INDEX "email_jobs_scheduledDatetime_idx" ON "email_jobs"("scheduledDatetime");

-- CreateIndex
CREATE INDEX "email_jobs_status_idx" ON "email_jobs"("status");

-- CreateIndex
CREATE INDEX "email_send_logs_emailJobId_idx" ON "email_send_logs"("emailJobId");

-- AddForeignKey
ALTER TABLE "uploaded_files" ADD CONSTRAINT "uploaded_files_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_jobs" ADD CONSTRAINT "email_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_jobs" ADD CONSTRAINT "email_jobs_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "uploaded_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_send_logs" ADD CONSTRAINT "email_send_logs_emailJobId_fkey" FOREIGN KEY ("emailJobId") REFERENCES "email_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
