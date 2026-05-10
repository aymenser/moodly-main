// ==============================================
// site-config.js — Website behavior + image slots
// Moodly
//
// Replace local paths with your own image files or remote URLs.
// Local images can be placed in:
//   assets/hero/
//   assets/story/
// ==============================================

const runtimeConfig = window.MOODLY_CONFIG || {};

export const API_BASE = runtimeConfig.API_BASE || 'http://localhost:8080/api';
export const ADMIN_APP_URL = runtimeConfig.ADMIN_APP_URL || 'http://localhost:3000';
export const STOREFRONT_URL = runtimeConfig.STOREFRONT_URL || 'http://localhost:5500';

// Set this to false if the section snap feeling is too strong.
export const ENABLE_SECTION_SNAP = true;

// Used by the newsletter fallback. Replace with the store email.
export const NEWSLETTER_RECEIVER_EMAIL = 'contact@moodly.dz';

export const HERO_SLIDES = [
  {
    image: 'assets/hero/hero-1.svg',
    eyebrow: 'Nouvelle collection',
    title: 'Mood doux',
    caption: 'Des pièces légères pour vos journées élégantes.',
  },
  {
    image: 'assets/hero/hero-2.svg',
    eyebrow: 'Sélection premium',
    title: 'Couleurs calmes',
    caption: 'Des tons modernes, faciles à porter.',
  },
  {
    image: 'assets/hero/hero-3.svg',
    eyebrow: 'Livraison Algérie',
    title: 'Chez vous',
    caption: 'Commandez simplement, recevez rapidement.',
  },
];

export const STORY_IMAGE = {
  image: 'assets/story/story-main.svg',
  eyebrow: 'Moodly depuis 2021',
  title: 'Mode féminine sélectionnée avec soin',
};
