import { notFound } from 'next/navigation';

export default function SmokePage(): never {
  // 스모크 테스트 페이지는 빙고 데이 기간 임시 비활성
  notFound();
}
