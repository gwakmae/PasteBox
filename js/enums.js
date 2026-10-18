const PasteType = {
    TEXT: 'text',
    HTML: 'html',
    TEMPLATE: 'template'
};

const PasteTypeLabels = {
    [PasteType.TEXT]: 'Text',
    [PasteType.HTML]: 'Rich HTML',
    [PasteType.TEMPLATE]: 'Template'
};

const PasteTypeColors = {
    [PasteType.TEXT]: { bg: '#dbeafe', text: '#1e40af', border: '#2563eb' },
    [PasteType.HTML]: { bg: '#f3e8ff', text: '#5b21b6', border: '#7c3aed' },
    [PasteType.TEMPLATE]: { bg: '#dcfce7', text: '#166534', border: '#16a34a' }
};
