/**
 * 나라장터 comUtil.gfnFormatPhone과 동일한 규칙으로
 * 전화번호를 표시한다.
 *
 * @param value 포맷할 전화번호 문자열. 생략하면 빈 문자열을 사용한다.
 * @param separator 번호 구간 사이에 넣을 구분자. 기본값은 하이픈(-)이다.
 * @returns 변환된 전화번호 문자열. 처리 중 오류가 발생하면 undefined를 반환한다.
 */
export function formatG2bPhone(
  value: string = "",
  separator = "-",
): string | undefined {
  try {
    // 원본 함수와 동일하게 번호 안의 공백을 모두 제거한 후 길이와 접두어를 판별한다.
    const phone = value.replace(/\s+/g, "");

    // 0303~0305 및 0501~0509는 일반 번호 길이 분기보다 먼저 별도 정규식으로 처리한다.
    const specialPrefixes = [
      "0303",
      "0304",
      "0305",
      "0501",
      "0502",
      "0503",
      "0504",
      "0505",
      "0506",
      "0507",
      "0508",
      "0509",
    ];

    // 특수 접두어는 4자리 국번을 기준으로 세 구간을 구분한다.
    // 정규식에 맞지 않으면 replace는 원래 문자열을 그대로 반환한다.
    if (specialPrefixes.includes(phone.substring(0, 4))) {
      return phone.replace(
        /^(01[0136789]{1}|00|02|0[3-9]{1}[0-9]{1}[0-9]{1})-?([*0-9]{3,4})-?([0-9]{4})$/,
        `$1${separator}$2${separator}$3`,
      );
    }

    // 7~8자리 번호는 앞 3~4자리와 뒤 4자리로 구분한다.
    // 별표(*)가 포함된 일부 마스킹 번호도 이 정규식에서 허용한다.
    if (phone.length === 7 || phone.length === 8) {
      return phone.replace(/^([*0-9]{3,4})-?([0-9]{4})$/, `$1${separator}$2`);
    }

    // 10자리 번호는 서울 지역번호(02) 여부에 따라 구간 길이를 다르게 적용한다.
    if (phone.length === 10) {
      return phone.startsWith("02")
        ? phone.replace(
            /([0-9]{2})([0-9]{4})([0-9]+)/,
            `$1${separator}$2${separator}$3`,
          )
        : phone.replace(
            /([0-9]{3})([0-9]{3})([0-9]+)/,
            `$1${separator}$2${separator}$3`,
          );
    }

    // 나머지 11자리 이하 번호는 원본의 접두어·마스킹 허용 규칙으로 변환한다.
    if (phone.length <= 11) {
      return phone.replace(
        /^(01[0136789]{1}|00|02|0[3-9]{1}[0-9]{1})-?([*0-9]{3,4})-?([0-9]{4})$/,
        `$1${separator}$2${separator}$3`,
      );
    }

    // 어느 형식에도 해당하지 않으면 공백만 제거한 값을 유지한다.
    return phone;
  } catch (error) {
    // 원본 함수와 같이 오류를 기록하고 값을 반환하지 않는다.
    console.error(error);
    return undefined;
  }
}
