import React, { useState, useEffect } from 'react';
import AxiosCustom from '../../../axios/AxiosCustom';

const API_URL = `/api/bim/element`;

export default function ElementEditPanel({ element, onClose, onUpdate }) {
    // 폼 입력 값을 관리할 상태
    const [formData, setFormData] = useState({ 
        elementId: element.elementId,
        material: element.material || '',
        
        // 💡 새 필드 초기화 (Number 타입으로 저장, 입력은 String으로 받음)
        positionX: element.positionX ?? '', 
        positionY: element.positionY ?? '',
        positionZ: element.positionZ ?? '',
        
        sizeX: element.sizeX ?? '',
        sizeY: element.sizeY ?? '',
        sizeZ: element.sizeZ ?? '',
    });
    const [isSaving, setIsSaving] = useState(false);

    // element prop이 변경될 때마다 formData를 업데이트
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
            alert(`부재 ${element.elementId}의 정보가 성공적으로 수정되었습니다.`);
            onClose();

        } catch (error) {
            console.error("Element update failed:", error);
            alert("수정 실패: 서버 오류 또는 데이터 형식 오류. 콘솔을 확인하세요.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed right-0 top-0 w-80 h-full bg-space-800/95 border-l border-space-700 p-6 shadow-xl z-50">
            <h3 className="text-xl font-bold mb-4 text-accent-orange">부재 속성 수정</h3>
            <p className="text-sm text-gray-400 mb-6">ID: {element.elementId} ({element.elementType})</p>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-300">재질 (Material)</label>
                    <input
                        type="text"
                        name="material"
                        value={formData.material}
                        onChange={handleChange}
                        className="mt-1 w-full p-2 bg-space-700 border border-space-600 rounded-md text-gray-200"
                    />
                </div>
             <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-300">위치 (Position)</label>
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
                    <label className="block text-sm font-medium text-gray-300">크기 (Size)</label>
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
                        닫기
                    </button>
                    <button
                        type="submit"
                        className="px-4 py-2 bg-blue-600 rounded-lg text-white hover:bg-blue-500 transition"
                        disabled={isSaving}
                    >
                        {isSaving ? '저장 중...' : '변경 사항 저장'}
                    </button>
                </div>
            </form>
        </div>
    );
}