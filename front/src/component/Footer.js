import { useT } from '../i18n/LanguageContext';

export default function Footer() {
    const t = useT('footer');

    return (
        <footer className="border-t border-space-700/70">
            <div className="mx-auto max-w-7xl px-4 py-3 text-xs text-gray-500">
                {t('copyright')}
            </div>
        </footer>
    )
}
