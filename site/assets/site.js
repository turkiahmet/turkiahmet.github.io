const pageField = document.getElementById('citation-page');
if (pageField) pageField.addEventListener('input', () => {
  document.querySelectorAll('[data-citation-page]').forEach((span) => {
    span.textContent = pageField.value.trim() || span.dataset.placeholder;
  });
});
document.querySelectorAll('[data-copy-citation]').forEach((button) => {
  button.addEventListener('click', async () => {
    const citation = document.getElementById(button.dataset.copyCitation);
    const status = button.closest('.citation-box').querySelector('.copy-status');
    try {
      await navigator.clipboard.writeText(citation.textContent.trim());
      status.textContent = button.dataset.success;
    } catch {
      status.textContent = button.dataset.failure;
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(citation);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
});
