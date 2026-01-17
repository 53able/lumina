import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { CategoryListResponseSchema } from "../../shared/schemas.js";
/**
 * デフォルトで選択されるカテゴリID
 */
const DEFAULT_CATEGORY_IDS = ["cs.AI", "cs.LG", "cs.CL", "stat.ML"];
/**
 * arXivカテゴリの定義
 * 参照: https://arxiv.org/category_taxonomy
 */
const ARXIV_CATEGORIES = [
    // Computer Science
    { id: "cs.AI", name: "Artificial Intelligence", group: "Computer Science", isDefault: true },
    { id: "cs.CL", name: "Computation and Language", group: "Computer Science", isDefault: true },
    { id: "cs.CC", name: "Computational Complexity", group: "Computer Science", isDefault: false },
    {
        id: "cs.CE",
        name: "Computational Engineering, Finance, and Science",
        group: "Computer Science",
        isDefault: false,
    },
    { id: "cs.CG", name: "Computational Geometry", group: "Computer Science", isDefault: false },
    {
        id: "cs.CV",
        name: "Computer Vision and Pattern Recognition",
        group: "Computer Science",
        isDefault: false,
    },
    { id: "cs.CY", name: "Computers and Society", group: "Computer Science", isDefault: false },
    { id: "cs.CR", name: "Cryptography and Security", group: "Computer Science", isDefault: false },
    { id: "cs.DB", name: "Databases", group: "Computer Science", isDefault: false },
    {
        id: "cs.DS",
        name: "Data Structures and Algorithms",
        group: "Computer Science",
        isDefault: false,
    },
    { id: "cs.DL", name: "Digital Libraries", group: "Computer Science", isDefault: false },
    { id: "cs.DM", name: "Discrete Mathematics", group: "Computer Science", isDefault: false },
    {
        id: "cs.DC",
        name: "Distributed, Parallel, and Cluster Computing",
        group: "Computer Science",
        isDefault: false,
    },
    { id: "cs.ET", name: "Emerging Technologies", group: "Computer Science", isDefault: false },
    {
        id: "cs.FL",
        name: "Formal Languages and Automata Theory",
        group: "Computer Science",
        isDefault: false,
    },
    {
        id: "cs.GT",
        name: "Computer Science and Game Theory",
        group: "Computer Science",
        isDefault: false,
    },
    { id: "cs.GR", name: "Graphics", group: "Computer Science", isDefault: false },
    { id: "cs.AR", name: "Hardware Architecture", group: "Computer Science", isDefault: false },
    { id: "cs.HC", name: "Human-Computer Interaction", group: "Computer Science", isDefault: false },
    { id: "cs.IR", name: "Information Retrieval", group: "Computer Science", isDefault: false },
    { id: "cs.IT", name: "Information Theory", group: "Computer Science", isDefault: false },
    { id: "cs.LG", name: "Machine Learning", group: "Computer Science", isDefault: true },
    { id: "cs.LO", name: "Logic in Computer Science", group: "Computer Science", isDefault: false },
    { id: "cs.MS", name: "Mathematical Software", group: "Computer Science", isDefault: false },
    { id: "cs.MA", name: "Multiagent Systems", group: "Computer Science", isDefault: false },
    { id: "cs.MM", name: "Multimedia", group: "Computer Science", isDefault: false },
    {
        id: "cs.NI",
        name: "Networking and Internet Architecture",
        group: "Computer Science",
        isDefault: false,
    },
    {
        id: "cs.NE",
        name: "Neural and Evolutionary Computing",
        group: "Computer Science",
        isDefault: false,
    },
    { id: "cs.NA", name: "Numerical Analysis", group: "Computer Science", isDefault: false },
    { id: "cs.OS", name: "Operating Systems", group: "Computer Science", isDefault: false },
    { id: "cs.OH", name: "Other Computer Science", group: "Computer Science", isDefault: false },
    { id: "cs.PF", name: "Performance", group: "Computer Science", isDefault: false },
    { id: "cs.PL", name: "Programming Languages", group: "Computer Science", isDefault: false },
    { id: "cs.RO", name: "Robotics", group: "Computer Science", isDefault: false },
    {
        id: "cs.SI",
        name: "Social and Information Networks",
        group: "Computer Science",
        isDefault: false,
    },
    { id: "cs.SE", name: "Software Engineering", group: "Computer Science", isDefault: false },
    { id: "cs.SD", name: "Sound", group: "Computer Science", isDefault: false },
    { id: "cs.SC", name: "Symbolic Computation", group: "Computer Science", isDefault: false },
    { id: "cs.SY", name: "Systems and Control", group: "Computer Science", isDefault: false },
    // Statistics
    { id: "stat.ML", name: "Machine Learning", group: "Statistics", isDefault: true },
    { id: "stat.AP", name: "Applications", group: "Statistics", isDefault: false },
    { id: "stat.CO", name: "Computation", group: "Statistics", isDefault: false },
    { id: "stat.ME", name: "Methodology", group: "Statistics", isDefault: false },
    { id: "stat.OT", name: "Other Statistics", group: "Statistics", isDefault: false },
    { id: "stat.TH", name: "Statistics Theory", group: "Statistics", isDefault: false },
    // Mathematics
    { id: "math.AG", name: "Algebraic Geometry", group: "Mathematics", isDefault: false },
    { id: "math.AT", name: "Algebraic Topology", group: "Mathematics", isDefault: false },
    { id: "math.AP", name: "Analysis of PDEs", group: "Mathematics", isDefault: false },
    { id: "math.CT", name: "Category Theory", group: "Mathematics", isDefault: false },
    { id: "math.CA", name: "Classical Analysis and ODEs", group: "Mathematics", isDefault: false },
    { id: "math.CO", name: "Combinatorics", group: "Mathematics", isDefault: false },
    { id: "math.AC", name: "Commutative Algebra", group: "Mathematics", isDefault: false },
    { id: "math.CV", name: "Complex Variables", group: "Mathematics", isDefault: false },
    { id: "math.DG", name: "Differential Geometry", group: "Mathematics", isDefault: false },
    { id: "math.DS", name: "Dynamical Systems", group: "Mathematics", isDefault: false },
    { id: "math.FA", name: "Functional Analysis", group: "Mathematics", isDefault: false },
    { id: "math.GM", name: "General Mathematics", group: "Mathematics", isDefault: false },
    { id: "math.GN", name: "General Topology", group: "Mathematics", isDefault: false },
    { id: "math.GT", name: "Geometric Topology", group: "Mathematics", isDefault: false },
    { id: "math.GR", name: "Group Theory", group: "Mathematics", isDefault: false },
    { id: "math.HO", name: "History and Overview", group: "Mathematics", isDefault: false },
    { id: "math.IT", name: "Information Theory", group: "Mathematics", isDefault: false },
    { id: "math.KT", name: "K-Theory and Homology", group: "Mathematics", isDefault: false },
    { id: "math.LO", name: "Logic", group: "Mathematics", isDefault: false },
    { id: "math.MP", name: "Mathematical Physics", group: "Mathematics", isDefault: false },
    { id: "math.MG", name: "Metric Geometry", group: "Mathematics", isDefault: false },
    { id: "math.NT", name: "Number Theory", group: "Mathematics", isDefault: false },
    { id: "math.NA", name: "Numerical Analysis", group: "Mathematics", isDefault: false },
    { id: "math.OA", name: "Operator Algebras", group: "Mathematics", isDefault: false },
    { id: "math.OC", name: "Optimization and Control", group: "Mathematics", isDefault: false },
    { id: "math.PR", name: "Probability", group: "Mathematics", isDefault: false },
    { id: "math.QA", name: "Quantum Algebra", group: "Mathematics", isDefault: false },
    { id: "math.RT", name: "Representation Theory", group: "Mathematics", isDefault: false },
    { id: "math.RA", name: "Rings and Algebras", group: "Mathematics", isDefault: false },
    { id: "math.SP", name: "Spectral Theory", group: "Mathematics", isDefault: false },
    { id: "math.ST", name: "Statistics Theory", group: "Mathematics", isDefault: false },
    { id: "math.SG", name: "Symplectic Geometry", group: "Mathematics", isDefault: false },
    // Physics
    { id: "quant-ph", name: "Quantum Physics", group: "Physics", isDefault: false },
    {
        id: "gr-qc",
        name: "General Relativity and Quantum Cosmology",
        group: "Physics",
        isDefault: false,
    },
    { id: "hep-ex", name: "High Energy Physics - Experiment", group: "Physics", isDefault: false },
    { id: "hep-lat", name: "High Energy Physics - Lattice", group: "Physics", isDefault: false },
    { id: "hep-ph", name: "High Energy Physics - Phenomenology", group: "Physics", isDefault: false },
    { id: "hep-th", name: "High Energy Physics - Theory", group: "Physics", isDefault: false },
    { id: "nucl-ex", name: "Nuclear Experiment", group: "Physics", isDefault: false },
    { id: "nucl-th", name: "Nuclear Theory", group: "Physics", isDefault: false },
    { id: "physics.acc-ph", name: "Accelerator Physics", group: "Physics", isDefault: false },
    { id: "physics.app-ph", name: "Applied Physics", group: "Physics", isDefault: false },
    {
        id: "physics.ao-ph",
        name: "Atmospheric and Oceanic Physics",
        group: "Physics",
        isDefault: false,
    },
    { id: "physics.atom-ph", name: "Atomic Physics", group: "Physics", isDefault: false },
    { id: "physics.bio-ph", name: "Biological Physics", group: "Physics", isDefault: false },
    { id: "physics.chem-ph", name: "Chemical Physics", group: "Physics", isDefault: false },
    { id: "physics.class-ph", name: "Classical Physics", group: "Physics", isDefault: false },
    { id: "physics.comp-ph", name: "Computational Physics", group: "Physics", isDefault: false },
    {
        id: "physics.data-an",
        name: "Data Analysis, Statistics and Probability",
        group: "Physics",
        isDefault: false,
    },
    { id: "physics.flu-dyn", name: "Fluid Dynamics", group: "Physics", isDefault: false },
    { id: "physics.gen-ph", name: "General Physics", group: "Physics", isDefault: false },
    { id: "physics.geo-ph", name: "Geophysics", group: "Physics", isDefault: false },
    {
        id: "physics.hist-ph",
        name: "History and Philosophy of Physics",
        group: "Physics",
        isDefault: false,
    },
    {
        id: "physics.ins-det",
        name: "Instrumentation and Detectors",
        group: "Physics",
        isDefault: false,
    },
    { id: "physics.med-ph", name: "Medical Physics", group: "Physics", isDefault: false },
    { id: "physics.optics", name: "Optics", group: "Physics", isDefault: false },
    { id: "physics.plasm-ph", name: "Plasma Physics", group: "Physics", isDefault: false },
    { id: "physics.pop-ph", name: "Popular Physics", group: "Physics", isDefault: false },
    { id: "physics.soc-ph", name: "Physics and Society", group: "Physics", isDefault: false },
    { id: "physics.space-ph", name: "Space Physics", group: "Physics", isDefault: false },
];
/**
 * カテゴリ一覧取得のルート定義
 */
export const listCategoriesRoute = createRoute({
    method: "get",
    path: "/api/v1/categories",
    tags: ["categories"],
    summary: "カテゴリ一覧取得",
    description: "arXivカテゴリの一覧とデフォルト選択を返します",
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: CategoryListResponseSchema,
                },
            },
            description: "カテゴリ一覧",
        },
    },
});
/**
 * カテゴリAPIアプリケーション
 */
export const categoriesApp = new OpenAPIHono();
categoriesApp.openapi(listCategoriesRoute, (c) => {
    return c.json({
        categories: ARXIV_CATEGORIES,
        defaultCategoryIds: DEFAULT_CATEGORY_IDS,
    }, 200);
});
