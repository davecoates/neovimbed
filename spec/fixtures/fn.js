export default class NeovimBridge {

    windowManager: VirtualWindowManager;
    client: Nvim;
    gridSize: GridSize;
    subscriptions: CompositeDisposable;

    constructor(client: Nvim, gridColumnCount: number, gridRowCount: number) {
        this.client = client;
        this.gridSize = { rows: Math.floor(gridRowCount / 2), columns: gridColumnCount };
        this.subscriptions = new CompositeDisposable();
        this.windowManager = new LegacyVirtualWindowManager(this.client, this.gridSize);

    }

    initialise() : Promise {
        return this.initialiseNeovim().then(this.initialiseAtom.bind(this));
    }

    async readBuffer(details:BufferDetails) {
        this.windowManager.onReadBuffer(details);
    }

}
