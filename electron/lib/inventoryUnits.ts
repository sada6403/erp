const aliases:Record<string,string>={pc:'pcs',piece:'pcs',pieces:'pcs',kg:'kg',kgs:'kg',kilogram:'kg',kilograms:'kg',g:'g',gm:'g',gram:'g',grams:'g',l:'ltr',litre:'ltr',litres:'ltr',liter:'ltr',liters:'ltr',ml:'ml',bag:'bag',bags:'bag',carton:'carton',cartons:'carton',ctn:'carton',box:'box',boxes:'box',packet:'packet',packets:'packet',pkt:'packet',pack:'pack',packs:'pack'}
export function stockUnit(unit:string){const value=unit.trim().toLowerCase();return aliases[value]||value}
/** Number of base units in one entered unit. Packs always need a product-specific factor. */
export function stockUnitFactor(entered:string,base:string,packs:{uom_name:string;conversion_factor:number}[]=[]){
 const from=stockUnit(entered),to=stockUnit(base)
 if(from===to)return 1
 const measures:Record<string,{family:string;scale:number}>={kg:{family:'mass',scale:1000},g:{family:'mass',scale:1},ltr:{family:'volume',scale:1000},ml:{family:'volume',scale:1}}
 if(measures[from]&&measures[to]&&measures[from].family===measures[to].family)return measures[from].scale/measures[to].scale
 const pack=packs.find(row=>stockUnit(row.uom_name)===from)
 if(pack&&Number.isFinite(pack.conversion_factor)&&pack.conversion_factor>0)return pack.conversion_factor
 throw new Error(`No conversion from ${entered} to ${base}. Configure this product's pack size first.`)
}
