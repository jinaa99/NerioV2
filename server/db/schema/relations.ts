import { relations } from 'drizzle-orm';
import { bookmarks, follows, notifications, readingHistory, readingProgress } from './activity';
import { adminAuditLogs } from './audit';
import { oauthAccounts, sessions } from './auth';
import { paymentRecords } from './billing';
import { chapterPages, chapters, characters, genres, glossaryTerms, series, seriesGenres, seriesTags, tags } from './catalog';
import { profiles, roles, userRoles, users } from './identity';
import { contentReports } from './moderation';
import { translationJobs, translationSegments } from './translation';

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles, { fields: [users.id], references: [profiles.userId] }),
  roles: many(userRoles, { relationName: 'userRoles' }),
  bookmarks: many(bookmarks),
  follows: many(follows),
  readingProgress: many(readingProgress),
  readingHistory: many(readingHistory),
  notifications: many(notifications),
  payments: many(paymentRecords, { relationName: 'payer' }),
  sessions: many(sessions),
  oauthAccounts: many(oauthAccounts),
}));

export const oauthAccountsRelations = relations(oauthAccounts, ({ one }) => ({
  user: one(users, { fields: [oauthAccounts.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, { fields: [profiles.userId], references: [users.id] }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(userRoles),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id], relationName: 'userRoles' }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));

export const seriesRelations = relations(series, ({ many }) => ({
  genres: many(seriesGenres),
  tags: many(seriesTags),
  chapters: many(chapters),
  glossary: many(glossaryTerms),
  characters: many(characters),
}));

export const genresRelations = relations(genres, ({ many }) => ({
  series: many(seriesGenres),
}));

export const seriesGenresRelations = relations(seriesGenres, ({ one }) => ({
  series: one(series, { fields: [seriesGenres.seriesId], references: [series.id] }),
  genre: one(genres, { fields: [seriesGenres.genreId], references: [genres.id] }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  series: many(seriesTags),
}));

export const seriesTagsRelations = relations(seriesTags, ({ one }) => ({
  series: one(series, { fields: [seriesTags.seriesId], references: [series.id] }),
  tag: one(tags, { fields: [seriesTags.tagId], references: [tags.id] }),
}));

export const chaptersRelations = relations(chapters, ({ one, many }) => ({
  series: one(series, { fields: [chapters.seriesId], references: [series.id] }),
  pages: many(chapterPages),
  jobs: many(translationJobs),
}));

export const chapterPagesRelations = relations(chapterPages, ({ one, many }) => ({
  chapter: one(chapters, { fields: [chapterPages.chapterId], references: [chapters.id] }),
  segments: many(translationSegments),
}));

export const glossaryTermsRelations = relations(glossaryTerms, ({ one }) => ({
  series: one(series, { fields: [glossaryTerms.seriesId], references: [series.id] }),
}));

export const charactersRelations = relations(characters, ({ one }) => ({
  series: one(series, { fields: [characters.seriesId], references: [series.id] }),
}));

export const readingProgressRelations = relations(readingProgress, ({ one }) => ({
  user: one(users, { fields: [readingProgress.userId], references: [users.id] }),
  series: one(series, { fields: [readingProgress.seriesId], references: [series.id] }),
  chapter: one(chapters, { fields: [readingProgress.chapterId], references: [chapters.id] }),
}));

export const readingHistoryRelations = relations(readingHistory, ({ one }) => ({
  user: one(users, { fields: [readingHistory.userId], references: [users.id] }),
  series: one(series, { fields: [readingHistory.seriesId], references: [series.id] }),
  chapter: one(chapters, { fields: [readingHistory.chapterId], references: [chapters.id] }),
}));

export const bookmarksRelations = relations(bookmarks, ({ one }) => ({
  user: one(users, { fields: [bookmarks.userId], references: [users.id] }),
  series: one(series, { fields: [bookmarks.seriesId], references: [series.id] }),
}));

export const followsRelations = relations(follows, ({ one }) => ({
  user: one(users, { fields: [follows.userId], references: [users.id] }),
  series: one(series, { fields: [follows.seriesId], references: [series.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const translationJobsRelations = relations(translationJobs, ({ one, many }) => ({
  chapter: one(chapters, { fields: [translationJobs.chapterId], references: [chapters.id] }),
  segments: many(translationSegments),
}));

export const translationSegmentsRelations = relations(translationSegments, ({ one }) => ({
  job: one(translationJobs, { fields: [translationSegments.jobId], references: [translationJobs.id] }),
  page: one(chapterPages, { fields: [translationSegments.pageId], references: [chapterPages.id] }),
}));

export const paymentRecordsRelations = relations(paymentRecords, ({ one }) => ({
  user: one(users, { fields: [paymentRecords.userId], references: [users.id], relationName: 'payer' }),
}));

export const adminAuditLogsRelations = relations(adminAuditLogs, ({ one }) => ({
  actor: one(users, { fields: [adminAuditLogs.actorId], references: [users.id] }),
}));

export const contentReportsRelations = relations(contentReports, ({ one }) => ({
  reporter: one(users, { fields: [contentReports.reporterId], references: [users.id] }),
  series: one(series, { fields: [contentReports.seriesId], references: [series.id] }),
  chapter: one(chapters, { fields: [contentReports.chapterId], references: [chapters.id] }),
}));
