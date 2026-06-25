// Minimal internationalization helper. Supports Korean and English with no
// external dependency. Strings are looked up by key with a Korean fallback.

import { Language } from './types.js';

type Dict = Record<string, string>;

const translations: Record<Language, Dict> = {
  ko: {
    appTitle: '칸반 보드',
    addCard: '+ 카드 추가',
    addColumn: '+ 리스트 추가',
    newColumnTitle: '새 리스트',
    newCardText: '새 카드',
    deleteColumnConfirm: '이 리스트를 삭제할까요?',
    deleteBoardConfirm: '이 보드를 삭제할까요?',
    renameColumn: '리스트 이름',
    boards: '보드',
    newBoard: '새 보드',
    rename: '이름 변경',
    delete: '삭제',
    exportJson: 'JSON 내보내기',
    importJson: 'JSON 가져오기',
    exportPng: 'PNG 저장',
    language: '언어',
    zoomIn: '확대',
    zoomOut: '축소',
    zoomReset: '원래대로',
    save: '저장',
    cancel: '취소',
    boardNamePrompt: '보드 이름을 입력하세요',
    emptyColumn: '카드가 없습니다',
    importError: 'JSON 파일을 읽을 수 없습니다',
  },
  en: {
    appTitle: 'Kanban Board',
    addCard: '+ Add card',
    addColumn: '+ Add list',
    newColumnTitle: 'New list',
    newCardText: 'New card',
    deleteColumnConfirm: 'Delete this list?',
    deleteBoardConfirm: 'Delete this board?',
    renameColumn: 'List title',
    boards: 'Boards',
    newBoard: 'New board',
    rename: 'Rename',
    delete: 'Delete',
    exportJson: 'Export JSON',
    importJson: 'Import JSON',
    exportPng: 'Save PNG',
    language: 'Language',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    zoomReset: 'Reset zoom',
    save: 'Save',
    cancel: 'Cancel',
    boardNamePrompt: 'Enter a board name',
    emptyColumn: 'No cards',
    importError: 'Could not read the JSON file',
  },
};

let current: Language = 'ko';

export function setLanguage(lang: Language): void {
  current = lang;
}

export function getLanguage(): Language {
  return current;
}

/** Translate a key into the current language, falling back to the key itself. */
export function t(key: string): string {
  return translations[current][key] ?? translations.ko[key] ?? key;
}
