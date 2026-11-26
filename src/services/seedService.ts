import { collection, doc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { generateId, stripUndefined } from './firestoreList';
import { calculateDocumentTotals } from '../lib/calculations';
import { filterMissingByKey, mergeCounterNextNumber, SEED_WAREHOUSES } from '../lib/demoCatalog';
import { Customer, Item, Vendor, Warehouse } from '../types';

const DEMO_IMAGES = {
  pipe: '/src/assets/images/part_petrol_pipe_1795689651604.jpg',
  plug: '/src/assets/images/part_plug_cap_1795689650911.jpg',
  brake: '/src/assets/images/part_brake_kit_1795689652118.jpg',
};

const SEED_PARTS: Array<{
  name: string;
  sku: string;
  unit: 'PCS' | 'SET' | 'BOX' | 'PAIR';
  category: string;
  brand: string;
  sellingPrice: number;
  costPrice: number;
  mainQty: number;
  showroomQty: number;
  reorderLevel: number;
  reorderQty: number;
  image?: string;
}> = [
  { name: 'PETROL PIPE PULSAR/DISCOVER 270mm', sku: 'YYPP005', unit: 'PCS', category: 'Fuel System', brand: 'Bajaj Genuine', sellingPrice: 450, costPrice: 280, mainQty: 85, showroomQty: 25, reorderLevel: 30, reorderQty: 100, image: DEMO_IMAGES.pipe },
  { name: 'PETROL PIPE SPLENDOR 170MM', sku: 'YYPP001', unit: 'PCS', category: 'Fuel System', brand: 'Hero OEM', sellingPrice: 320, costPrice: 195, mainQty: 14, showroomQty: 4, reorderLevel: 25, reorderQty: 80, image: DEMO_IMAGES.pipe },
  { name: 'PLUG CAP FIT FOR HH CD-100 BLACK', sku: 'YYP002', unit: 'PCS', category: 'Ignition', brand: 'NGK', sellingPrice: 380, costPrice: 225, mainQty: 120, showroomQty: 30, reorderLevel: 35, reorderQty: 100, image: DEMO_IMAGES.plug },
  { name: 'INNER COVER DIO 110 BS 3 N/M', sku: 'YYIC002', unit: 'PCS', category: 'Body Panels', brand: 'Honda OEM', sellingPrice: 3450, costPrice: 2400, mainQty: 6, showroomQty: 2, reorderLevel: 10, reorderQty: 20 },
  { name: 'DISC BRAKE PAD SET PULSAR 150/180', sku: 'YYBP150', unit: 'SET', category: 'Brakes', brand: 'Galfer', sellingPrice: 1650, costPrice: 1050, mainQty: 54, showroomQty: 18, reorderLevel: 20, reorderQty: 50, image: DEMO_IMAGES.brake },
  { name: 'REAR SPROCKET 42T PULSAR 150', sku: 'YYSP042', unit: 'PCS', category: 'Drive Train', brand: 'Rolon', sellingPrice: 2850, costPrice: 1980, mainQty: 22, showroomQty: 8, reorderLevel: 12, reorderQty: 30, image: DEMO_IMAGES.brake },
  { name: 'CHAIN & SPROCKET KIT DISCOVER 125', sku: 'YYCS125', unit: 'SET', category: 'Drive Train', brand: 'Rolon', sellingPrice: 5400, costPrice: 3850, mainQty: 18, showroomQty: 6, reorderLevel: 10, reorderQty: 25, image: DEMO_IMAGES.brake },
  { name: 'SPARK PLUG CR7HSA DIO / CT100', sku: 'YYSP007', unit: 'BOX', category: 'Ignition', brand: 'NGK', sellingPrice: 6800, costPrice: 4950, mainQty: 15, showroomQty: 5, reorderLevel: 8, reorderQty: 20, image: DEMO_IMAGES.plug },
  { name: 'CLUTCH PLATE SET CT100 / PLATINA', sku: 'YYCP100', unit: 'SET', category: 'Clutch & Transmission', brand: 'ASK', sellingPrice: 1850, costPrice: 1220, mainQty: 38, showroomQty: 12, reorderLevel: 15, reorderQty: 40 },
  { name: 'AIR FILTER ELEMENT DIO 110', sku: 'YYAF110', unit: 'PCS', category: 'Filters', brand: 'Honda OEM', sellingPrice: 950, costPrice: 620, mainQty: 9, showroomQty: 3, reorderLevel: 20, reorderQty: 60 },
  { name: 'OIL FILTER CARTRIDGE FZ-S / R15', sku: 'YYOF150', unit: 'PCS', category: 'Filters', brand: 'Yamaha OEM', sellingPrice: 650, costPrice: 410, mainQty: 72, showroomQty: 24, reorderLevel: 25, reorderQty: 80 },
  { name: 'FRONT FORK OIL SEAL PAIR PULSAR', sku: 'YYFS031', unit: 'PAIR', category: 'Suspension', brand: 'Gabriel', sellingPrice: 890, costPrice: 540, mainQty: 42, showroomQty: 10, reorderLevel: 15, reorderQty: 50 },
  { name: 'CLUTCH CABLE DISCOVER 125/135', sku: 'YYCC135', unit: 'PCS', category: 'Cables', brand: 'Suprajit', sellingPrice: 580, costPrice: 350, mainQty: 64, showroomQty: 16, reorderLevel: 20, reorderQty: 60 },
  { name: 'THROTTLE CABLE PULSAR 150 UG4', sku: 'YYTC150', unit: 'PCS', category: 'Cables', brand: 'Suprajit', sellingPrice: 620, costPrice: 380, mainQty: 48, showroomQty: 14, reorderLevel: 20, reorderQty: 50 },
  { name: 'SPEEDOMETER CABLE DIO 110', sku: 'YYSC110', unit: 'PCS', category: 'Cables', brand: 'Suprajit', sellingPrice: 540, costPrice: 320, mainQty: 7, showroomQty: 2, reorderLevel: 15, reorderQty: 45 },
  { name: 'HEADLIGHT BULB H4 12V 35/35W', sku: 'YYHB035', unit: 'BOX', category: 'Electrical', brand: 'Philips', sellingPrice: 4800, costPrice: 3450, mainQty: 28, showroomQty: 8, reorderLevel: 10, reorderQty: 25 },
  { name: 'CDI UNIT BAJAJ CT100 DC', sku: 'YYCD100', unit: 'PCS', category: 'Ignition', brand: 'Varroc', sellingPrice: 2650, costPrice: 1850, mainQty: 19, showroomQty: 5, reorderLevel: 8, reorderQty: 20 },
  { name: 'STARTER RELAY SOLENOID PULSAR', sku: 'YYSR012', unit: 'PCS', category: 'Electrical', brand: 'Minda', sellingPrice: 1250, costPrice: 820, mainQty: 31, showroomQty: 9, reorderLevel: 12, reorderQty: 30 },
  { name: 'BRAKE SHOE SET REAR CT100/SPLENDOR', sku: 'YYBS100', unit: 'PAIR', category: 'Brakes', brand: 'ASK', sellingPrice: 980, costPrice: 610, mainQty: 60, showroomQty: 20, reorderLevel: 25, reorderQty: 75, image: DEMO_IMAGES.brake },
  { name: 'CARBURETOR REPAIR KIT DISCOVER 125', sku: 'YYCK125', unit: 'SET', category: 'Fuel System', brand: 'Ucal', sellingPrice: 1450, costPrice: 960, mainQty: 25, showroomQty: 7, reorderLevel: 10, reorderQty: 30 },
  { name: 'DRIVE BELT V-BELT HONDA DIO', sku: 'YYVB110', unit: 'PCS', category: 'Drive Train', brand: 'Bando', sellingPrice: 2950, costPrice: 2050, mainQty: 5, showroomQty: 2, reorderLevel: 12, reorderQty: 30 },
  { name: 'ROLLER WEIGHT SET DIO 110 (6 PCS)', sku: 'YYRW110', unit: 'SET', category: 'Drive Train', brand: 'Honda OEM', sellingPrice: 1350, costPrice: 890, mainQty: 32, showroomQty: 8, reorderLevel: 12, reorderQty: 30 },
  { name: 'PISTON RING SET PULSAR 150 STD', sku: 'YYPR150', unit: 'SET', category: 'Engine', brand: 'Goetze', sellingPrice: 2250, costPrice: 1520, mainQty: 24, showroomQty: 6, reorderLevel: 10, reorderQty: 25 },
  { name: 'HEAD GASKET KIT CT100/PLATINA', sku: 'YYGK100', unit: 'SET', category: 'Engine', brand: 'Bajaj Genuine', sellingPrice: 780, costPrice: 480, mainQty: 55, showroomQty: 15, reorderLevel: 20, reorderQty: 60 },
  { name: 'CAM TIMING CHAIN 90L SPLENDOR', sku: 'YYTC090', unit: 'PCS', category: 'Engine', brand: 'Rolon', sellingPrice: 1120, costPrice: 720, mainQty: 34, showroomQty: 10, reorderLevel: 15, reorderQty: 40 },
  { name: 'REAR VIEW MIRROR PAIR FZ-S V2', sku: 'YYRM002', unit: 'PAIR', category: 'Body & Accessories', brand: 'Fiem', sellingPrice: 1750, costPrice: 1150, mainQty: 20, showroomQty: 8, reorderLevel: 10, reorderQty: 25 },
  { name: 'INDICATOR BLINKER ASSY PULSAR', sku: 'YYIN004', unit: 'PAIR', category: 'Electrical', brand: 'Fiem', sellingPrice: 1480, costPrice: 950, mainQty: 26, showroomQty: 10, reorderLevel: 12, reorderQty: 30 },
  { name: 'HORN 12V SINGLE TONE UNIVERSAL', sku: 'YYHN012', unit: 'PCS', category: 'Electrical', brand: 'Minda', sellingPrice: 920, costPrice: 580, mainQty: 40, showroomQty: 12, reorderLevel: 15, reorderQty: 40 },
  { name: 'BATTERY 12V 4AH MF SCOOTER', sku: 'YYBT004', unit: 'PCS', category: 'Electrical', brand: 'Exide', sellingPrice: 6950, costPrice: 5200, mainQty: 4, showroomQty: 2, reorderLevel: 10, reorderQty: 20 },
  { name: 'TUBE 2.75-18 HEAVY DUTY BUTYL', sku: 'YYTB275', unit: 'PCS', category: 'Tyres & Tubes', brand: 'CEAT', sellingPrice: 1650, costPrice: 1120, mainQty: 45, showroomQty: 15, reorderLevel: 18, reorderQty: 50 },
  { name: 'TUBELESS TYRE VALVE STEM BENT', sku: 'YYTV090', unit: 'BOX', category: 'Tyres & Tubes', brand: 'Schrader', sellingPrice: 3200, costPrice: 2150, mainQty: 12, showroomQty: 4, reorderLevel: 6, reorderQty: 15 },
  { name: 'IGNITION LOCK SET PULSAR 150', sku: 'YYIL150', unit: 'SET', category: 'Ignition', brand: 'Minda', sellingPrice: 3850, costPrice: 2650, mainQty: 11, showroomQty: 3, reorderLevel: 6, reorderQty: 15 },
  { name: 'REGULATOR RECTIFIER RR UNIT DIO', sku: 'YYRR110', unit: 'PCS', category: 'Electrical', brand: 'Varroc', sellingPrice: 2450, costPrice: 1680, mainQty: 16, showroomQty: 4, reorderLevel: 8, reorderQty: 20 },
  { name: 'WHEEL BEARING 6202-2RS JAPAN', sku: 'YYWB6202', unit: 'BOX', category: 'Bearings', brand: 'NTN', sellingPrice: 5600, costPrice: 3900, mainQty: 20, showroomQty: 5, reorderLevel: 8, reorderQty: 20 },
  { name: 'STEERING CONE BALL RACE KIT CT100', sku: 'YYSC001', unit: 'SET', category: 'Suspension', brand: 'NBC', sellingPrice: 1280, costPrice: 820, mainQty: 29, showroomQty: 9, reorderLevel: 12, reorderQty: 30 },
  { name: 'FOOTREST RUBBER PAIR SPLENDOR', sku: 'YYFR100', unit: 'PAIR', category: 'Body & Accessories', brand: 'Hero OEM', sellingPrice: 420, costPrice: 240, mainQty: 50, showroomQty: 20, reorderLevel: 20, reorderQty: 60 },
  { name: 'HANDLEBAR GRIP SET BLACK/BLUE', sku: 'YYHG008', unit: 'PAIR', category: 'Body & Accessories', brand: 'Bajaj Genuine', sellingPrice: 680, costPrice: 410, mainQty: 35, showroomQty: 15, reorderLevel: 15, reorderQty: 40 },
  { name: 'EXHAUST MUFFLER GASKET COPPER', sku: 'YYMG003', unit: 'BOX', category: 'Engine', brand: 'Elring', sellingPrice: 2400, costPrice: 1550, mainQty: 14, showroomQty: 4, reorderLevel: 6, reorderQty: 15 },
  { name: 'SILENCER HEAT SHIELD DIO 110', sku: 'YYHS110', unit: 'PCS', category: 'Body Panels', brand: 'Honda OEM', sellingPrice: 1850, costPrice: 1240, mainQty: 8, showroomQty: 2, reorderLevel: 10, reorderQty: 20 },
  { name: 'REAR SHOCK ABSORBER PAIR CT100', sku: 'YYSA100', unit: 'PAIR', category: 'Suspension', brand: 'Endurance', sellingPrice: 7850, costPrice: 5600, mainQty: 9, showroomQty: 3, reorderLevel: 6, reorderQty: 15 },
];

export const DEMO_SKUS = new Set(SEED_PARTS.map((p) => p.sku));

const SEED_CUSTOMERS = [
  { name: 'Lanka Moto Spares & Service', city: 'Colombo 10', phone: '+94 11 269 4421', email: 'orders@lankamoto.lk', terms: 'Net 30', creditLimit: 450000 },
  { name: 'Kandy Hill Bike Centre', city: 'Kandy', phone: '+94 81 223 1190', email: 'kandybike@gmail.com', terms: 'Net 15', creditLimit: 250000 },
  { name: 'Ruhunu Two-Wheeler Traders', city: 'Galle', phone: '+94 91 224 7782', email: 'ruhunu.tw@sltnet.lk', terms: 'Net 30', creditLimit: 300000 },
  { name: 'Wayamba Motors & Garage', city: 'Kurunegala', phone: '+94 37 222 8891', email: 'wayambamotors@lk.com', terms: 'Net 15', creditLimit: 200000 },
  { name: 'Negombo Lagoon Cycle Mart', city: 'Negombo', phone: '+94 31 223 5510', email: 'lagooncycles@gmail.com', terms: 'Due on Receipt', creditLimit: 150000 },
  { name: 'Gampaha Speed Parts', city: 'Gampaha', phone: '+94 33 222 9044', email: 'gampahaspeed@gmail.com', terms: 'Net 30', creditLimit: 350000 },
  { name: 'Matara Southern Spares', city: 'Matara', phone: '+94 41 222 6134', email: 'mataraspares@lk.com', terms: 'Net 30', creditLimit: 220000 },
  { name: 'Rajarata Auto & Bike House', city: 'Anuradhapura', phone: '+94 25 222 4099', email: 'rajaratabikes@gmail.com', terms: 'Net 45', creditLimit: 400000 },
  { name: 'Sabaragamuwa Moto Hub', city: 'Ratnapura', phone: '+94 45 222 7321', email: 'sabaramoto@gmail.com', terms: 'Net 15', creditLimit: 180000 },
  { name: 'Eastern Star Motorcycle Works', city: 'Batticaloa', phone: '+94 65 222 8840', email: 'easternstar@lk.com', terms: 'Net 30', creditLimit: 280000 },
];

const SEED_VENDORS = [
  { name: 'Colombo Auto Importers (Pvt) Ltd', city: 'Colombo 11', phone: '+94 11 232 9901', email: 'supply@colomboauto.lk', terms: 'Net 30' },
  { name: 'Ceylon Two-Wheeler Distributors', city: 'Peliyagoda', phone: '+94 11 291 4520', email: 'sales@ceylontw.lk', terms: 'Net 45' },
  { name: 'Indo-Lanka Genuine Parts Co.', city: 'Colombo 10', phone: '+94 11 268 7731', email: 'orders@indolankaparts.lk', terms: 'Net 30' },
  { name: 'Nippon Spark & Cable Holdings', city: 'Wattala', phone: '+94 11 293 1140', email: 'b2b@nipponcable.lk', terms: 'Net 15' },
  { name: 'Apex Friction & Sprocket Works', city: 'Kelaniya', phone: '+94 11 291 8812', email: 'accounts@apexfriction.lk', terms: 'Net 30' },
  { name: 'Serendib Battery & Electricals', city: 'Nugegoda', phone: '+94 11 285 6604', email: 'dispatch@serendibelectricals.lk', terms: 'Due on Receipt' },
];

function daysAgoDate(days: number): { iso: string } {
  const d = new Date(Date.now() - days * 86400000);
  return { iso: d.toISOString().slice(0, 10) };
}

export async function seedDemoData(
  orgId: string,
  userId: string,
  userName: string
): Promise<{
  items: number;
  warehouses: number;
  customers: number;
  vendors: number;
  orders: number;
  alreadyLoaded: boolean;
}> {
  const orgPath = `organizations/${orgId}`;
  try {
    const [whSnap, vendSnap, custSnap, itemSnap, soSnap, counterSnap] = await Promise.all([
      getDocs(collection(db, `${orgPath}/warehouses`)),
      getDocs(collection(db, `${orgPath}/vendors`)),
      getDocs(collection(db, `${orgPath}/customers`)),
      getDocs(collection(db, `${orgPath}/items`)),
      getDocs(collection(db, `${orgPath}/salesOrders`)),
      getDocs(collection(db, `${orgPath}/counters`)),
    ]);

    const existingWarehouses = whSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<Warehouse, 'id'>) }))
      .filter((w) => !w.isDeleted);
    const existingVendors = vendSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<Vendor, 'id'>) }))
      .filter((v) => !v.isDeleted);
    const existingCustomers = custSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<Customer, 'id'>) }))
      .filter((c) => !c.isDeleted);
    const existingItems = itemSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<Item, 'id'>) }))
      .filter((i) => !i.isDeleted);
    const hasExistingOrders = soSnap.docs.some((d) => !(d.data() as { isDeleted?: boolean }).isDeleted);
    const existingCounters: Record<string, number> = {};
    for (const cDoc of counterSnap.docs) {
      const data = cDoc.data() as { nextNumber?: number };
      if (typeof data.nextNumber === 'number') {
        existingCounters[cDoc.id] = data.nextNumber;
      }
    }

    const batch1 = writeBatch(db);
    let batch1Writes = 0;
    let warehousesCreated = 0;

    const mainDef = SEED_WAREHOUSES[0];
    const showDef = SEED_WAREHOUSES[1];
    let mainWhId =
      existingWarehouses.find(
        (w) => w.code === mainDef.code || w.name.toLowerCase() === mainDef.name.toLowerCase()
      )?.id || existingWarehouses[0]?.id;

    if (!mainWhId) {
      mainWhId = generateId();
      warehousesCreated += 1;
      batch1Writes += 1;
      batch1.set(doc(db, `${orgPath}/warehouses/${mainWhId}`), {
        organizationId: orgId,
        name: mainDef.name,
        code: mainDef.code,
        address: mainDef.address,
        city: mainDef.city,
        phone: mainDef.phone,
        isPrimary: existingWarehouses.length === 0,
        status: 'active',
        isDeleted: false,
        createdBy: userId,
        updatedBy: userId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    let showroomWhId =
      existingWarehouses.find(
        (w) =>
          w.id !== mainWhId &&
          (w.code === showDef.code || w.name.toLowerCase() === showDef.name.toLowerCase())
      )?.id || existingWarehouses.find((w) => w.id !== mainWhId)?.id;

    if (!showroomWhId) {
      showroomWhId = generateId();
      warehousesCreated += 1;
      batch1Writes += 1;
      batch1.set(doc(db, `${orgPath}/warehouses/${showroomWhId}`), {
        organizationId: orgId,
        name: showDef.name,
        code: showDef.code,
        address: showDef.address,
        city: showDef.city,
        phone: showDef.phone,
        isPrimary: false,
        status: 'active',
        isDeleted: false,
        createdBy: userId,
        updatedBy: userId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // Create missing Vendors (reuse existing ones for PO/item links)
    const missingVendors = filterMissingByKey(
      SEED_VENDORS,
      existingVendors.map((v) => v.name),
      (v) => v.name
    );
    const vendorRefs: { id: string; name: string; terms: string }[] = existingVendors.map((v) => ({
      id: v.id,
      name: v.name,
      terms: v.paymentTerms || 'Net 30',
    }));

    for (const v of missingVendors) {
      const id = generateId();
      vendorRefs.push({ id, name: v.name, terms: v.terms });
      batch1Writes += 1;
      batch1.set(doc(db, `${orgPath}/vendors/${id}`), {
        organizationId: orgId,
        name: v.name,
        companyName: v.name,
        email: v.email,
        phone: v.phone,
        paymentTerms: v.terms,
        billingAddress: {
          street: 'Main Supply Road',
          city: v.city,
          country: 'Sri Lanka',
          phone: v.phone,
        },
        status: 'active',
        isDeleted: false,
        createdBy: userId,
        updatedBy: userId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // Create missing Customers
    const missingCustomers = filterMissingByKey(
      SEED_CUSTOMERS,
      existingCustomers.map((c) => c.name),
      (c) => c.name
    );
    const customerRefs: { id: string; name: string; terms: string }[] = existingCustomers.map((c) => ({
      id: c.id,
      name: c.name,
      terms: c.paymentTerms || 'Net 30',
    }));

    for (const c of missingCustomers) {
      const id = generateId();
      customerRefs.push({ id, name: c.name, terms: c.terms });
      batch1Writes += 1;
      batch1.set(doc(db, `${orgPath}/customers/${id}`), {
        organizationId: orgId,
        name: c.name,
        companyName: c.name,
        email: c.email,
        phone: c.phone,
        paymentTerms: c.terms,
        creditLimit: c.creditLimit,
        billingAddress: {
          street: 'Commercial Street',
          city: c.city,
          country: 'Sri Lanka',
          phone: c.phone,
        },
        shippingAddress: {
          street: 'Commercial Street',
          city: c.city,
          country: 'Sri Lanka',
          phone: c.phone,
        },
        status: 'active',
        isDeleted: false,
        createdBy: userId,
        updatedBy: userId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // Create missing Demo Parts + Opening Ledger Entries
    const missingParts = filterMissingByKey(
      SEED_PARTS,
      existingItems.map((i) => i.sku),
      (p) => p.sku
    );
    const itemRefs: {
      id: string;
      name: string;
      sku: string;
      unit: string;
      sellingPrice: number;
      costPrice: number;
      reorderLevel: number;
      totalStock: number;
    }[] = existingItems.map((i) => ({
      id: i.id,
      name: i.name,
      sku: i.sku,
      unit: i.unit,
      sellingPrice: i.sellingPrice,
      costPrice: i.costPrice,
      reorderLevel: i.reorderLevel,
      totalStock: i.totalStock,
    }));

    for (let idx = 0; idx < missingParts.length; idx += 1) {
      const p = missingParts[idx];
      const id = generateId();
      const totalStock = p.mainQty + p.showroomQty;
      const prefVendor = vendorRefs[idx % Math.max(1, vendorRefs.length)];
      itemRefs.push({
        id,
        name: p.name,
        sku: p.sku,
        unit: p.unit,
        sellingPrice: p.sellingPrice,
        costPrice: p.costPrice,
        reorderLevel: p.reorderLevel,
        totalStock,
      });

      batch1Writes += 1;
      batch1.set(
        doc(db, `${orgPath}/items/${id}`),
        stripUndefined({
          organizationId: orgId,
          name: p.name,
          sku: p.sku,
          unit: p.unit,
          category: p.category,
          brand: p.brand,
          manufacturer: p.brand,
          sellingPrice: p.sellingPrice,
          costPrice: p.costPrice,
          taxRate: 18,
          taxInclusive: false,
          preferredVendorId: prefVendor?.id,
          openingStock: totalStock,
          reorderLevel: p.reorderLevel,
          reorderQty: p.reorderQty,
          barcode: `890${String(100000 + idx)}`,
          images: p.image ? [p.image] : [],
          stockByWarehouse: {
            [mainWhId]: p.mainQty,
            [showroomWhId]: p.showroomQty,
          },
          committedByWarehouse: {},
          totalStock,
          totalCommitted: 0,
          status: 'active',
          isDeleted: false,
          createdBy: userId,
          updatedBy: userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      // Opening ledger entries for Main Store & Showroom
      const openDate = daysAgoDate(90);
      batch1.set(doc(db, `${orgPath}/stockLedger/${generateId()}`), {
        organizationId: orgId,
        itemId: id,
        itemName: p.name,
        itemSku: p.sku,
        warehouseId: mainWhId,
        quantityChange: p.mainQty,
        type: 'opening',
        referenceType: 'item',
        referenceId: id,
        referenceNumber: p.sku,
        unitCost: p.costPrice,
        date: openDate.iso,
        userId,
        notes: 'Initial Main Store stock',
        createdBy: userId,
        updatedBy: userId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      batch1.set(doc(db, `${orgPath}/stockLedger/${generateId()}`), {
        organizationId: orgId,
        itemId: id,
        itemName: p.name,
        itemSku: p.sku,
        warehouseId: showroomWhId,
        quantityChange: p.showroomQty,
        type: 'opening',
        referenceType: 'item',
        referenceId: id,
        referenceNumber: p.sku,
        unitCost: p.costPrice,
        date: openDate.iso,
        userId,
        notes: 'Initial Showroom stock',
        createdBy: userId,
        updatedBy: userId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (totalStock <= p.reorderLevel) {
        batch1.set(doc(db, `${orgPath}/notifications/${generateId()}`), {
          organizationId: orgId,
          title: `Below Reorder Level: ${p.sku}`,
          message: `${p.name} has ${totalStock} ${p.unit} on hand (reorder level: ${p.reorderLevel}).`,
          type: 'low_stock',
          entityId: id,
          link: `/items/${id}`,
          read: false,
          isDeleted: false,
          createdBy: userId,
          updatedBy: userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    if (batch1Writes > 0) {
      await batch1.commit();
    }

    const shouldSeedOrders =
      !hasExistingOrders &&
      itemRefs.length > 0 &&
      customerRefs.length > 0 &&
      vendorRefs.length > 0;

    if (!shouldSeedOrders) {
      const nothingNew =
        missingParts.length === 0 &&
        warehousesCreated === 0 &&
        missingCustomers.length === 0 &&
        missingVendors.length === 0;
      return {
        items: missingParts.length,
        warehouses: warehousesCreated,
        customers: missingCustomers.length,
        vendors: missingVendors.length,
        orders: 0,
        alreadyLoaded: nothingNew,
      };
    }

    // Batch 2: 90 days of Sales Orders, Packages, Shipments, Invoices, Payments, Purchase Orders, Receives, Bills, Payments Made
    const batch2 = writeBatch(db);
    const channels: Array<'Direct' | 'Counter' | 'Wholesale' | 'Online'> = [
      'Direct',
      'Counter',
      'Wholesale',
      'Online',
    ];
    const soStatuses: Array<'confirmed' | 'packed' | 'shipped' | 'delivered' | 'invoiced'> = [
      'confirmed',
      'packed',
      'shipped',
      'delivered',
      'invoiced',
    ];

    let soSeq = 1;
    let pkgSeq = 1;
    let shpSeq = 1;
    let invSeq = 1;
    let paySeq = 1;

    for (let dayOffset = 84; dayOffset >= 1; dayOffset -= 6) {
      const cust = customerRefs[(dayOffset + soSeq) % customerRefs.length];
      const itemA = itemRefs[(soSeq * 3) % itemRefs.length];
      const itemB = itemRefs[(soSeq * 5 + 1) % itemRefs.length];
      const qtyA = 4 + (soSeq % 6);
      const qtyB = 2 + (soSeq % 4);
      const dt = daysAgoDate(dayOffset);
      const status =
        dayOffset <= 8
          ? soStatuses[soSeq % 3]
          : dayOffset <= 18
            ? 'delivered'
            : 'invoiced';

      const totals = calculateDocumentTotals(
        [
          {
            itemId: itemA.id,
            itemName: itemA.name,
            sku: itemA.sku,
            unit: itemA.unit,
            warehouseId: mainWhId,
            quantity: qtyA,
            rate: itemA.sellingPrice,
            taxRate: 18,
          },
          {
            itemId: itemB.id,
            itemName: itemB.name,
            sku: itemB.sku,
            unit: itemB.unit,
            warehouseId: mainWhId,
            quantity: qtyB,
            rate: itemB.sellingPrice,
            taxRate: 18,
          },
        ],
        'percent',
        0,
        350,
        0
      );

      const soId = generateId();
      const soNum = `SO-${String(soSeq).padStart(5, '0')}`;
      soSeq += 1;

      batch2.set(
        doc(db, `${orgPath}/salesOrders/${soId}`),
        stripUndefined({
          organizationId: orgId,
          orderNumber: soNum,
          customerId: cust.id,
          customerName: cust.name,
          date: dt.iso,
          expectedShipmentDate: dt.iso,
          channel: channels[soSeq % channels.length],
          warehouseId: mainWhId,
          paymentTerms: cust.terms,
          status,
          lines: totals.lines,
          subtotal: totals.subtotal,
          discountType: 'percent',
          discountValue: 0,
          discountAmount: totals.discountAmount,
          taxTotal: totals.taxTotal,
          shippingCharges: 350,
          adjustment: 0,
          total: totals.total,
          isDeleted: false,
          createdBy: userId,
          updatedBy: userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      if (status === 'packed' || status === 'shipped' || status === 'delivered' || status === 'invoiced') {
        const pkgId = generateId();
        const pkgNum = `PKG-${String(pkgSeq).padStart(5, '0')}`;
        pkgSeq += 1;
        batch2.set(doc(db, `${orgPath}/packages/${pkgId}`), {
          organizationId: orgId,
          packageNumber: pkgNum,
          salesOrderId: soId,
          salesOrderNumber: soNum,
          customerId: cust.id,
          customerName: cust.name,
          warehouseId: mainWhId,
          date: dt.iso,
          status: status === 'packed' ? 'not_shipped' : status === 'shipped' ? 'shipped' : 'delivered',
          lines: totals.lines.map((l) => ({
            itemId: l.itemId,
            itemName: l.itemName,
            sku: l.sku,
            quantity: l.quantity,
          })),
          isDeleted: false,
          createdBy: userId,
          updatedBy: userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        if (status !== 'packed') {
          const shpId = generateId();
          const shpNum = `SHP-${String(shpSeq).padStart(5, '0')}`;
          shpSeq += 1;
          batch2.set(doc(db, `${orgPath}/shipments/${shpId}`), {
            organizationId: orgId,
            shipmentNumber: shpNum,
            salesOrderId: soId,
            salesOrderNumber: soNum,
            packageId: pkgId,
            packageNumber: pkgNum,
            customerId: cust.id,
            customerName: cust.name,
            warehouseId: mainWhId,
            date: dt.iso,
            carrier: 'Prompt Express LK',
            trackingNumber: `PEX-${10040 + shpSeq}`,
            shippingCost: 350,
            status: status === 'shipped' ? 'shipped' : 'delivered',
            lines: [
              { itemId: itemA.id, itemName: itemA.name, sku: itemA.sku, quantity: qtyA, unitCost: itemA.costPrice },
              { itemId: itemB.id, itemName: itemB.name, sku: itemB.sku, quantity: qtyB, unitCost: itemB.costPrice },
            ],
            isDeleted: false,
            createdBy: userId,
            updatedBy: userId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      if (status === 'invoiced' || dayOffset <= 24) {
        const invId = generateId();
        const invNum = `INV-${String(invSeq).padStart(6, '0')}`;
        invSeq += 1;
        const isPaid = dayOffset > 20;
        const isPartial = !isPaid && dayOffset > 10;
        const paidAmt = isPaid ? totals.total : isPartial ? Math.round(totals.total * 0.5) : 0;
        const bal = Math.max(0, totals.total - paidAmt);

        batch2.set(
          doc(db, `${orgPath}/invoices/${invId}`),
          stripUndefined({
            organizationId: orgId,
            invoiceNumber: invNum,
            salesOrderId: soId,
            salesOrderNumber: soNum,
            customerId: cust.id,
            customerName: cust.name,
            date: dt.iso,
            dueDate: daysAgoDate(Math.max(0, dayOffset - 15)).iso,
            paymentTerms: cust.terms,
            warehouseId: mainWhId,
            channel: channels[soSeq % channels.length],
            status: isPaid ? 'paid' : isPartial ? 'partially_paid' : dayOffset > 16 ? 'overdue' : 'sent',
            lines: totals.lines,
            subtotal: totals.subtotal,
            discountType: 'percent',
            discountValue: 0,
            discountAmount: 0,
            taxTotal: totals.taxTotal,
            shippingCharges: 350,
            adjustment: 0,
            total: totals.total,
            amountPaid: paidAmt,
            balanceDue: bal,
            isDeleted: false,
            createdBy: userId,
            updatedBy: userId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );

        if (paidAmt > 0) {
          const payId = generateId();
          const payNum = `PAY-${String(paySeq).padStart(5, '0')}`;
          paySeq += 1;
          batch2.set(doc(db, `${orgPath}/paymentsReceived/${payId}`), {
            organizationId: orgId,
            paymentNumber: payNum,
            customerId: cust.id,
            customerName: cust.name,
            date: daysAgoDate(Math.max(0, dayOffset - 3)).iso,
            mode: paySeq % 2 === 0 ? 'Bank Transfer' : 'Cash',
            referenceNumber: `TXN-${8820 + paySeq}`,
            amount: paidAmt,
            allocations: [{ invoiceId: invId, invoiceNumber: invNum, amountApplied: paidAmt }],
            isDeleted: false,
            createdBy: userId,
            updatedBy: userId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
    }

    // Purchase Orders, Receives, Bills, Payments Made (8 POs across 90 days)
    let poSeq = 1;
    let prSeq = 1;
    let billSeq = 1;
    let pmSeq = 1;

    for (let dayOffset = 75; dayOffset >= 5; dayOffset -= 10) {
      const vend = vendorRefs[poSeq % vendorRefs.length];
      const itemA = itemRefs[(poSeq * 2) % itemRefs.length];
      const itemB = itemRefs[(poSeq * 4 + 3) % itemRefs.length];
      const dt = daysAgoDate(dayOffset);
      const poId = generateId();
      const poNum = `PO-${String(poSeq).padStart(5, '0')}`;
      poSeq += 1;

      const totals = calculateDocumentTotals([
        {
          itemId: itemA.id,
          itemName: itemA.name,
          sku: itemA.sku,
          unit: itemA.unit,
          warehouseId: mainWhId,
          quantity: 20,
          rate: itemA.costPrice,
          taxRate: 18,
        },
        {
          itemId: itemB.id,
          itemName: itemB.name,
          sku: itemB.sku,
          unit: itemB.unit,
          warehouseId: mainWhId,
          quantity: 15,
          rate: itemB.costPrice,
          taxRate: 18,
        },
      ]);

      const poStatus =
        dayOffset <= 6 ? 'issued' : dayOffset <= 16 ? 'partially_received' : 'billed';

      batch2.set(
        doc(db, `${orgPath}/purchaseOrders/${poId}`),
        stripUndefined({
          organizationId: orgId,
          poNumber: poNum,
          vendorId: vend.id,
          vendorName: vend.name,
          date: dt.iso,
          expectedDeliveryDate: dt.iso,
          warehouseId: mainWhId,
          status: poStatus,
          lines: totals.lines.map((l) => ({
            ...l,
            receivedQty: poStatus === 'issued' ? 0 : poStatus === 'partially_received' ? Math.floor(l.quantity / 2) : l.quantity,
          })),
          subtotal: totals.subtotal,
          discountType: 'percent',
          discountValue: 0,
          discountAmount: 0,
          taxTotal: totals.taxTotal,
          shippingCharges: 0,
          adjustment: 0,
          total: totals.total,
          isDeleted: false,
          createdBy: userId,
          updatedBy: userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );

      if (poStatus !== 'issued') {
        const prId = generateId();
        const prNum = `PR-${String(prSeq).padStart(5, '0')}`;
        prSeq += 1;
        batch2.set(doc(db, `${orgPath}/purchaseReceives/${prId}`), {
          organizationId: orgId,
          receiveNumber: prNum,
          purchaseOrderId: poId,
          poNumber: poNum,
          vendorId: vend.id,
          vendorName: vend.name,
          warehouseId: mainWhId,
          date: dt.iso,
          status: poStatus === 'partially_received' ? 'in_progress' : 'received',
          lines: totals.lines.map((l) => ({
            itemId: l.itemId,
            itemName: l.itemName,
            sku: l.sku,
            orderedQty: l.quantity,
            receivedQty: poStatus === 'partially_received' ? Math.floor(l.quantity / 2) : l.quantity,
            unitCost: l.rate,
          })),
          isDeleted: false,
          createdBy: userId,
          updatedBy: userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (poStatus === 'billed') {
        const billId = generateId();
        const billNum = `BILL-${String(billSeq).padStart(5, '0')}`;
        billSeq += 1;
        const paid = dayOffset > 25;
        batch2.set(
          doc(db, `${orgPath}/bills/${billId}`),
          stripUndefined({
            organizationId: orgId,
            billNumber: billNum,
            purchaseOrderId: poId,
            poNumber: poNum,
            vendorId: vend.id,
            vendorName: vend.name,
            date: dt.iso,
            dueDate: daysAgoDate(Math.max(0, dayOffset - 30)).iso,
            paymentTerms: vend.terms,
            warehouseId: mainWhId,
            status: paid ? 'paid' : 'open',
            lines: totals.lines,
            subtotal: totals.subtotal,
            discountType: 'percent',
            discountValue: 0,
            discountAmount: 0,
            taxTotal: totals.taxTotal,
            shippingCharges: 0,
            adjustment: 0,
            total: totals.total,
            amountPaid: paid ? totals.total : 0,
            balanceDue: paid ? 0 : totals.total,
            isDeleted: false,
            createdBy: userId,
            updatedBy: userId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );

        if (paid) {
          const pmId = generateId();
          const pmNum = `PM-${String(pmSeq).padStart(5, '0')}`;
          pmSeq += 1;
          batch2.set(doc(db, `${orgPath}/paymentsMade/${pmId}`), {
            organizationId: orgId,
            paymentNumber: pmNum,
            vendorId: vend.id,
            vendorName: vend.name,
            date: dt.iso,
            mode: 'Bank Transfer',
            referenceNumber: `VTX-${4410 + pmSeq}`,
            amount: totals.total,
            allocations: [{ billId, billNumber: billNum, amountApplied: totals.total }],
            isDeleted: false,
            createdBy: userId,
            updatedBy: userId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
    }

    // Update sequential counters so new transactions don't overlap seeded numbers
    const counterUpdates: Record<string, { prefix: string; nextNumber: number; padding: number }> = {
      salesOrders: { prefix: 'SO-', nextNumber: soSeq, padding: 5 },
      packages: { prefix: 'PKG-', nextNumber: pkgSeq, padding: 5 },
      shipments: { prefix: 'SHP-', nextNumber: shpSeq, padding: 5 },
      invoices: { prefix: 'INV-', nextNumber: invSeq, padding: 6 },
      paymentsReceived: { prefix: 'PAY-', nextNumber: paySeq, padding: 5 },
      purchaseOrders: { prefix: 'PO-', nextNumber: poSeq, padding: 5 },
      purchaseReceives: { prefix: 'PR-', nextNumber: prSeq, padding: 5 },
      bills: { prefix: 'BILL-', nextNumber: billSeq, padding: 5 },
      paymentsMade: { prefix: 'PM-', nextNumber: pmSeq, padding: 5 },
    };

    for (const [key, cfg] of Object.entries(counterUpdates)) {
      batch2.set(doc(db, `${orgPath}/counters/${key}`), {
        organizationId: orgId,
        prefix: cfg.prefix,
        nextNumber: mergeCounterNextNumber(existingCounters[key], cfg.nextNumber),
        padding: cfg.padding,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });
    }

    // Activity Log summary entry
    batch2.set(doc(db, `${orgPath}/activityLog/${generateId()}`), {
      organizationId: orgId,
      userId,
      userName: userName.slice(0, 120),
      module: 'Settings',
      action: 'Loaded Demo Data',
      entityId: orgId,
      entityName: 'A & P Brothers Demo Catalog',
      details: `Seeded ${missingParts.length} spare parts, ${warehousesCreated} warehouses, ${missingCustomers.length} customers, ${missingVendors.length} vendors, and 90 days of orders.`,
      createdBy: userId,
      updatedBy: userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await batch2.commit();

    return {
      items: missingParts.length,
      warehouses: warehousesCreated,
      customers: missingCustomers.length,
      vendors: missingVendors.length,
      orders: soSeq - 1,
      alreadyLoaded: false,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, orgPath);
  }
}

async function commitSoftDeleteRefs(
  refs: Array<{ ref: ReturnType<typeof doc>; extra?: Record<string, unknown> }>,
  userId: string
): Promise<void> {
  const CHUNK_SIZE = 400;
  for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
    const chunk = refs.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const entry of chunk) {
      batch.update(entry.ref, {
        isDeleted: true,
        ...(entry.extra || {}),
        updatedBy: userId,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }
}

export async function clearDemoItems(
  orgId: string,
  userId: string,
  userName: string,
  scope: 'demo' | 'all' = 'demo'
): Promise<{ clearedItems: number; clearedNotifications: number }> {
  const orgPath = `organizations/${orgId}`;
  try {
    const itemsSnap = await getDocs(collection(db, `${orgPath}/items`));
    const targetItemIds = new Set<string>();
    const itemRefs: Array<{ ref: ReturnType<typeof doc> }> = [];

    for (const d of itemsSnap.docs) {
      const data = d.data() as { sku?: string; isDeleted?: boolean };
      if (data.isDeleted === true) continue;
      if (scope === 'all' || (data.sku && DEMO_SKUS.has(data.sku))) {
        targetItemIds.add(d.id);
        itemRefs.push({ ref: d.ref });
      }
    }

    await commitSoftDeleteRefs(itemRefs, userId);

    const notifSnap = await getDocs(collection(db, `${orgPath}/notifications`));
    const notifRefs: Array<{ ref: ReturnType<typeof doc>; extra?: Record<string, unknown> }> = [];
    for (const d of notifSnap.docs) {
      const data = d.data() as { entityId?: string; isDeleted?: boolean };
      if (data.isDeleted === true) continue;
      if (scope === 'all' || (data.entityId && targetItemIds.has(data.entityId))) {
        notifRefs.push({ ref: d.ref, extra: { read: true } });
      }
    }
    await commitSoftDeleteRefs(notifRefs, userId);

    const logBatch = writeBatch(db);
    logBatch.set(doc(db, `${orgPath}/activityLog/${generateId()}`), {
      organizationId: orgId,
      userId,
      userName: userName.slice(0, 120),
      module: 'Items',
      action: scope === 'demo' ? 'Cleared Demo Items' : 'Cleared Item Catalog',
      entityId: orgId,
      entityName: 'Item Catalog',
      details: `Removed ${itemRefs.length} ${scope === 'demo' ? 'demo ' : ''}item(s) from catalog.`,
      createdBy: userId,
      updatedBy: userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await logBatch.commit();

    return {
      clearedItems: itemRefs.length,
      clearedNotifications: notifRefs.length,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${orgPath}/items`);
  }
}

export async function clearAllDemoData(
  orgId: string,
  userId: string,
  userName: string
): Promise<{ clearedRecords: number }> {
  const orgPath = `organizations/${orgId}`;
  const subcollections = [
    'items',
    'customers',
    'vendors',
    'salesOrders',
    'packages',
    'shipments',
    'invoices',
    'paymentsReceived',
    'salesReturns',
    'creditNotes',
    'purchaseOrders',
    'purchaseReceives',
    'bills',
    'paymentsMade',
    'vendorCredits',
    'notifications',
  ];

  try {
    const refs: Array<{ ref: ReturnType<typeof doc>; extra?: Record<string, unknown> }> = [];
    for (const col of subcollections) {
      const snap = await getDocs(collection(db, `${orgPath}/${col}`));
      for (const d of snap.docs) {
        const data = d.data() as { isDeleted?: boolean };
        if (data.isDeleted === true) continue;
        refs.push({
          ref: d.ref,
          extra: col === 'notifications' ? { read: true } : undefined,
        });
      }
    }

    await commitSoftDeleteRefs(refs, userId);

    const logBatch = writeBatch(db);
    logBatch.set(doc(db, `${orgPath}/activityLog/${generateId()}`), {
      organizationId: orgId,
      userId,
      userName: userName.slice(0, 120),
      module: 'Settings',
      action: 'Cleared Demo Workspace Data',
      entityId: orgId,
      entityName: 'Workspace Catalog & Transactions',
      details: `Cleared ${refs.length} record(s) across catalog and transactions.`,
      createdBy: userId,
      updatedBy: userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await logBatch.commit();

    return { clearedRecords: refs.length };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, orgPath);
  }
}
