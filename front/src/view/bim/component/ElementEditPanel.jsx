import React, { useState, useEffect } from 'react';
import AxiosCustom from '../../../axios/AxiosCustom';

const API_URL = `/api/bim/element`;

export default function ElementEditPanel({ element, onClose, onUpdate }) {
    const [formData, setFormData] = useState({
        elementId: element.elementId,
        material: element.material || '',
        positionX: element.positionX ?? '',
        positionY: element.positionY ?? '',
        positionZ: element.positionZ ?? '',
        sizeX: element.sizeX ?? '',
        sizeY: element.sizeY ?? '',
        sizeZ: element.sizeZ ?? '',
    });
    const [isSaving, setIsSaving] = useState(false);
    const [showProps, setShowProps] = useState(true);

    // ifcProperties JSON 파싱
    const ifcProps = (() => {
        try { return element.ifcProperties ? JSON.parse(element.ifcProperties) : null; }
        catch { return null; }
    })();

    useEffect(() => {
        setFormData({
            elementId: element.elementId,
            material: element.material || '',
            positionX: element.positionX ?? '',
            positionY: element.positionY ?? '',
            positionZ: element.positionZ ?? '',
            sizeX: element.sizeX ?? '',
            sizeY: element.sizeY ?? '',
            sizeZ: element.sizeZ ?? '',
        });
    }, [element]);

    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value,
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        
        // 1. 서버로 전송할 최종 데이터 준비
        const dataToSend = {
            elementId: formData.elementId,
            material: formData.material,
            
            // 💡 문자열 입력 값을 숫자로 변환하여 전송 (빈 문자열은 null로 보내짐)
            positionX: parseFloat(formData.positionX) || null,
            positionY: parseFloat(formData.positionY) || null,
            positionZ: parseFloat(formData.positionZ) || null,
            
            sizeX: parseFloat(formData.sizeX) || null,
            sizeY: parseFloat(formData.sizeY) || null,
            sizeZ: parseFloat(formData.sizeZ) || null,
        };
        
        try {
            // 2. Spring API로 PUT 요청 전송
            await AxiosCustom.put(API_URL, dataToSend);
            
            // 3. 상태 갱신 및 UI 닫기
            onUpdate(dataToSend); // 부모 컴포넌트의 상태 갱신 함수 호출
            alert(`Member ${element.elementId} updated successfully.`);
            onClose();

        } catch (error) {
            console.error("Element update failed:", error);
            alert("Update failed: server error or invalid data format. Check console.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed right-0 top-0 w-80 h-full bg-space-800/95 border-l border-space-700 p-6 shadow-xl z-50 overflow-y-auto">
            <h3 className="text-xl font-bold mb-1 text-accent-orange">Edit Member Info</h3>
            <p className="text-xs text-gray-500 mb-1">{element.elementId} · {element.elementType}</p>
            {element.ifcName && (
                <p className="text-xs text-gray-400 mb-1">Name: <span className="text-gray-200">{element.ifcName}</span></p>
            )}
            {element.globalId && (
                <p className="text-xs text-gray-600 mb-4 font-mono break-all">GUID: {element.globalId}</p>
            )}

            {/* ── IFC 속성 뷰어 ── */}
            {ifcProps && Object.keys(ifcProps).length > 0 && (
                <div className="mb-5">
                    <button
                        className="flex items-center gap-1 text-xs font-semibold text-blue-400 mb-2 w-full text-left"
                        onClick={() => setShowProps(v => !v)}
                    >
                        <span>{showProps ? '▾' : '▸'}</span>
                        IFC Properties ({Object.keys(ifcProps).length})
                    </button>
                    {showProps && (
                        <div className="rounded-lg overflow-hidden border border-space-600 text-xs">
                            {Object.entries(ifcProps).map(([key, val], i) => (
                                <div
                                    key={key}
                                    className="flex gap-2 px-3 py-1.5"
                                    style={{ backgroundColor: i % 2 === 0 ? '#0f1a26' : '#111e2d' }}
                                >
                                    <span className="text-gray-500 flex-shrink-0 w-32 truncate" title={key}>{key}</span>
                                    <span className="text-gray-200 break-all">
                                        {val === null ? <span className="text-gray-600 italic">null</span>
                                         : val === true  ? <span className="text-green-400">true</span>
                                         : val === false ? <span className="text-red-400">false</span>
                                         : String(val)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}


            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-300">Material</label>
                    <input
                        type="text"
                        name="material"
                        value={formData.material}
                        onChange={handleChange}
                        className="mt-1 w-full p-2 bg-space-700 border border-space-600 rounded-md text-gray-200"
                    />
                </div>
             <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-300">Position</label>
                    <div className="flex space-x-2">
                        {['X', 'Y', 'Z'].map(axis => (
                            <input
                                key={`position${axis}`}
                                type="number" // 숫자로 입력 받음
                                name={`position${axis}`}
                                value={formData[`position${axis}`]}
                                onChange={handleChange}
                                placeholder={axis}
                                step="0.01"
                                className="mt-1 w-1/3 p-2 bg-space-700 border border-space-600 rounded-md text-gray-200 text-center"
                            />
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-300">Size</label>
                    <div className="flex space-x-2">
                        {['X', 'Y', 'Z'].map(axis => (
                            <input
                                key={`size${axis}`}
                                type="number" // 숫자로 입력 받음
                                name={`size${axis}`}
                                value={formData[`size${axis}`]}
                                onChange={handleChange}
                                placeholder={axis}
                                step="0.01"
                                className="mt-1 w-1/3 p-2 bg-space-700 border border-space-600 rounded-md text-gray-200 text-center"
                            />
                        ))}
                    </div>
                </div>
                
                <div className="flex justify-end pt-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-gray-400 hover:text-gray-200 transition mr-3"
                        disabled={isSaving}
                    >
                        Close
                    </button>
                    <button
                        type="submit"
                        className="px-4 py-2 bg-blue-600 rounded-lg text-white hover:bg-blue-500 transition"
                        disabled={isSaving}
                    >
                        {isSaving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </form>
        </div>
    );
}