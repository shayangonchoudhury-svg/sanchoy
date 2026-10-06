// Sanchoy Unified Modal Management System
// Accessible, keyboard-friendly, with backdrop blur and smooth transitions

let activeModal = null;
let previousActiveElement = null;

export function openModal(htmlContent, options = {}) {
  const backdrop = document.getElementById('modalBackdrop');
  const content = document.getElementById('modalContent');
  if (!backdrop || !content) return;

  previousActiveElement = document.activeElement;
  activeModal = { options };

  content.innerHTML = htmlContent;

  // Apply optional max-width custom class
  const modalBox = backdrop.querySelector('.modal');
  if (modalBox) {
    modalBox.className = `modal w-full ${options.maxWidth || 'max-w-lg'} sanchoy-card p-6 transform transition-all duration-300 scale-95 overflow-hidden`;
  }

  backdrop.classList.remove('hidden');
  backdrop.style.display = 'flex';

  requestAnimationFrame(() => {
    backdrop.classList.add('show');
    if (modalBox) {
      modalBox.classList.remove('scale-95');
      modalBox.classList.add('scale-100');
    }
  });

  if (typeof options.onOpen === 'function') {
    options.onOpen(content);
  }

  // Set focus inside modal
  const focusable = content.querySelector('input, select, textarea, button');
  if (focusable) {
    focusable.focus();
  }
}

export function closeModal() {
  const backdrop = document.getElementById('modalBackdrop');
  if (!backdrop) return;

  const modalBox = backdrop.querySelector('.modal');
  if (modalBox) {
    modalBox.classList.remove('scale-100');
    modalBox.classList.add('scale-95');
  }

  backdrop.classList.remove('show');
  setTimeout(() => {
    backdrop.classList.add('hidden');
    backdrop.style.display = 'none';
    const content = document.getElementById('modalContent');
    if (content) content.innerHTML = '';
    
    if (activeModal && typeof activeModal.options.onClose === 'function') {
      activeModal.options.onClose();
    }
    activeModal = null;

    if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
      previousActiveElement.focus();
      previousActiveElement = null;
    }
  }, 200);
}

export function initModalListeners() {
  const backdrop = document.getElementById('modalBackdrop');
  if (!backdrop) return;

  // Click outside modal box to close
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      closeModal();
    }
  });

  // ESC key to close
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.classList.contains('show')) {
      closeModal();
    }
  });
}
