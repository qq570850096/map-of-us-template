export type CityInfo = {
  id: string;
  name: string;
  nameEn: string;
};

export const cityNameById = new Map<string, CityInfo>([
  ["beijing", { id: "beijing", name: "北京", nameEn: "Beijing" }],
  ["shanghai", { id: "shanghai", name: "上海", nameEn: "Shanghai" }],
  ["guangzhou", { id: "guangzhou", name: "广州", nameEn: "Guangzhou" }],
  ["hangzhou", { id: "hangzhou", name: "杭州", nameEn: "Hangzhou" }],
  ["hongkong", { id: "hongkong", name: "香港", nameEn: "Hong Kong" }],
  ["macau", { id: "macau", name: "澳门", nameEn: "Macau" }],
  ["qingdao", { id: "qingdao", name: "青岛", nameEn: "Qingdao" }],
  ["zhengzhou", { id: "zhengzhou", name: "郑州", nameEn: "Zhengzhou" }],
  ["zhuhai", { id: "zhuhai", name: "珠海", nameEn: "Zhuhai" }],
  ["jinan", { id: "jinan", name: "济南", nameEn: "Jinan" }],
]);

export const cityInfo = (cityId: string, fallback?: Partial<CityInfo>) => {
  const city = cityNameById.get(cityId);
  if (city) return city;
  return {
    id: cityId,
    name: fallback?.name ?? cityId,
    nameEn: fallback?.nameEn ?? cityId,
  };
};
