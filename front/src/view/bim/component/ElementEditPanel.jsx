import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:8080/api/bim/element'; 

export default function ElementEditPanel({ element, onClose, onUpdate }) {
    // 폼 입력 값을 관리할 상태
    const [formData, setFormData] = useState({ 
        elementId: element.elementId,
        material: element.material || '',
        positionData: element.positionData || '', // JSON 문자열 또는 List<Float>을 가정
        // sizeData 등 필요한 필드 추가
    });
    const [isSaving, setIsSaving] = useState(false);

    // element prop이 변경될 때마다 formData를 업데이트
    useEffect(() => {
        setFormData({ 
            ...element, 
            positionData: Array.isArray(element.positionData) 
                ? element.positionData.join(', ') // 배열을 문자열로 변환 (사용자 편집용)
                : element.positionData || '' 
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
            ...formData,
            // ⚠️ List<Float>을 사용하는 경우: 문자열을 파싱하여 숫자로 변환
            positionData: formData.positionData.split(',').map(s => parseFloat(s.trim()))
        };
        
        try {
            // 2. Spring API로 PUT 요청 전송
            await axios.put(API_URL, dataToSend); 
            
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
                <div>
                    <label className="block text-sm font-medium text-gray-300">위치 데이터 (Position: x, y, z)</label>
                    <input
                        type="text"
                        name="positionData"
                        value={formData.positionData}
                        onChange={handleChange}
                        className="mt-1 w-full p-2 bg-space-700 border border-space-600 rounded-md text-gray-200"
                        placeholder="예: 5.0, 2.5, 0.0"
                    />
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