<script setup lang="ts">
import siteSettings from '../../../site-settings.json'

const footerLinks = Array.isArray(siteSettings.footerLinks) ? siteSettings.footerLinks : []
</script>

<template>
  <div v-if="footerLinks.length" class="footer-links-container">
    <div class="footer-links">
      <a v-for="link in footerLinks" :key="`${link.label}-${link.url}`" :href="link.url" class="footer-link">{{ link.label }}</a>
    </div>
  </div>
</template>

<style scoped>
.footer-links-container {
  margin-top: 2rem;
}

.footer-links {
  display: flex;
  gap: 1.5rem;
  margin-bottom: 1rem;
}

.footer-link {
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
  text-decoration: none;
}

.footer-link:hover {
  color: var(--vp-c-brand-1);
}
</style>
